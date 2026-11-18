package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"time"

	"github.com/xssnick/tonutils-go/address"
	"github.com/xssnick/tonutils-go/liteclient"
	"github.com/xssnick/tonutils-go/ton"
)

const (
	testnetConfigURL = "https://ton.org/testnet-global.config.json"
	verifierVersion  = "0.1.0"
	defaultMaxScan   = 500
	maxAllowedScan   = 10000
	pageSize         = 100
)

type request struct {
	Network  string `json:"network"`
	Address  string `json:"address"`
	LT       string `json:"lt"`
	Hash     string `json:"hash"`
	MaxScan  int    `json:"maxScan,omitempty"`
}

type response struct {
	Verified             bool   `json:"verified"`
	Network              string `json:"network"`
	Address              string `json:"address"`
	TransactionLT        string `json:"transactionLt"`
	TransactionHash      string `json:"transactionHash"`
	MasterchainSeqno     uint32 `json:"masterchainSeqno,omitempty"`
	MasterchainRootHash  string `json:"masterchainRootHash,omitempty"`
	AccountLastTxLT      string `json:"accountLastTxLt,omitempty"`
	ScannedTransactions  int    `json:"scannedTransactions"`
	ProofPolicy          string `json:"proofPolicy"`
	VerifierVersion      string `json:"verifierVersion"`
	Reason               string `json:"reason,omitempty"`
}

func parseRequest(r io.Reader) (request, *address.Address, uint64, []byte, error) {
	var req request
	decoder := json.NewDecoder(io.LimitReader(r, 16*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		return req, nil, 0, nil, fmt.Errorf("invalid_request_json: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return req, nil, 0, nil, errors.New("unexpected_trailing_json")
	}
	if req.Network != "testnet" {
		return req, nil, 0, nil, errors.New("unsupported_network_testnet_only")
	}
	if req.Address == "" || req.LT == "" || req.Hash == "" {
		return req, nil, 0, nil, errors.New("address_lt_and_hash_required")
	}
	addr, err := address.ParseRawAddr(req.Address)
	if err != nil {
		return req, nil, 0, nil, fmt.Errorf("invalid_address: %w", err)
	}
	if addr.Workchain() != 0 && addr.Workchain() != -1 {
		return req, nil, 0, nil, errors.New("unsupported_workchain")
	}
	lt, err := strconv.ParseUint(req.LT, 10, 64)
	if err != nil || lt == 0 {
		return req, nil, 0, nil, errors.New("invalid_transaction_lt")
	}
	hash, err := hex.DecodeString(req.Hash)
	if err != nil || len(hash) != 32 {
		return req, nil, 0, nil, errors.New("transaction_hash_must_be_32_byte_hex")
	}
	if req.MaxScan == 0 {
		req.MaxScan = defaultMaxScan
	}
	if req.MaxScan < 1 || req.MaxScan > maxAllowedScan {
		return req, nil, 0, nil, errors.New("max_scan_out_of_range")
	}
	return req, addr, lt, hash, nil
}

func verify(ctx context.Context, req request, addr *address.Address, targetLT uint64, targetHash []byte) (response, error) {
	result := response{
		Verified:        false,
		Network:         "testnet",
		Address:         addr.StringRaw(),
		TransactionLT:   strconv.FormatUint(targetLT, 10),
		TransactionHash: hex.EncodeToString(targetHash),
		ProofPolicy:     "secure",
		VerifierVersion: verifierVersion,
	}

	cfg, err := liteclient.GetConfigFromUrl(ctx, testnetConfigURL)
	if err != nil {
		return result, fmt.Errorf("testnet_config_unavailable: %w", err)
	}
	pool := liteclient.NewConnectionPool()
	if err = pool.AddConnectionsFromConfig(ctx, cfg); err != nil {
		return result, fmt.Errorf("liteserver_connection_failed: %w", err)
	}

	api := ton.NewAPIClient(pool, ton.ProofCheckPolicySecure).WithRetryTimeout(3, 8*time.Second)
	api.SetTrustedBlockFromConfig(cfg)

	master, err := api.CurrentMasterchainInfo(ctx)
	if err != nil {
		return result, fmt.Errorf("masterchain_proof_verification_failed: %w", err)
	}
	result.MasterchainSeqno = master.SeqNo
	result.MasterchainRootHash = hex.EncodeToString(master.RootHash)

	account, err := api.GetAccount(ctx, master, addr)
	if err != nil {
		return result, fmt.Errorf("account_state_proof_verification_failed: %w", err)
	}
	if !account.IsActive || account.LastTxLT == 0 || len(account.LastTxHash) != 32 {
		return result, errors.New("account_has_no_proved_transaction_history")
	}
	result.AccountLastTxLT = strconv.FormatUint(account.LastTxLT, 10)

	cursorLT := account.LastTxLT
	cursorHash := append([]byte(nil), account.LastTxHash...)
	scanned := 0

	for scanned < req.MaxScan {
		limit := pageSize
		if remaining := req.MaxScan - scanned; remaining < limit {
			limit = remaining
		}
		transactions, listErr := api.ListTransactions(ctx, addr, uint32(limit), cursorLT, cursorHash)
		if listErr != nil {
			return result, fmt.Errorf("transaction_history_proof_failed: %w", listErr)
		}
		if len(transactions) == 0 {
			break
		}

		for _, tx := range transactions {
			scanned++
			if !bytes.Equal(tx.AccountAddr, addr.Data()) {
				return result, errors.New("transaction_account_mismatch")
			}
			if tx.LT == targetLT && bytes.Equal(tx.Hash, targetHash) {
				result.Verified = true
				result.ScannedTransactions = scanned
				return result, nil
			}
		}

		oldest := transactions[0]
		if oldest.PrevTxLT == 0 || len(oldest.PrevTxHash) != 32 {
			break
		}
		if oldest.PrevTxLT >= cursorLT || bytes.Equal(oldest.PrevTxHash, cursorHash) {
			return result, errors.New("transaction_history_cursor_did_not_advance")
		}
		cursorLT = oldest.PrevTxLT
		cursorHash = append(cursorHash[:0], oldest.PrevTxHash...)
	}

	result.ScannedTransactions = scanned
	result.Reason = "transaction_not_found_within_scan_limit"
	return result, nil
}

func main() {
	req, addr, targetLT, targetHash, err := parseRequest(os.Stdin)
	if err != nil {
		writeError(err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	result, err := verify(ctx, req, addr, targetLT, targetHash)
	if err != nil {
		writeError(err)
		return
	}
	_ = json.NewEncoder(os.Stdout).Encode(result)
}

func writeError(err error) {
	_ = json.NewEncoder(os.Stdout).Encode(response{
		Verified:        false,
		Network:         "testnet",
		ProofPolicy:     "secure",
		VerifierVersion: verifierVersion,
		Reason:          err.Error(),
	})
	os.Exit(1)
}
