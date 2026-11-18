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
	"strings"
	"time"

	"github.com/xssnick/tonutils-go/address"
	"github.com/xssnick/tonutils-go/liteclient"
	"github.com/xssnick/tonutils-go/ton"
	"github.com/xssnick/tonutils-go/tlb"
	"github.com/xssnick/tonutils-go/tvm/cell"
)

const (
	testnetConfigURL = "https://ton.org/testnet-global.config.json"
	verifierVersion  = "0.2.0"
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
	CurrentAccountCodeHash string `json:"currentAccountCodeHash,omitempty"`
	EscrowEvents           []escrowLifecycleEvent `json:"escrowEvents,omitempty"`
	EventDecodeErrors      []string `json:"eventDecodeErrors,omitempty"`
}

type escrowLifecycleEventBody struct {
	_               tlb.Magic         `tlb:"#445552E0"`
	SchemaVersion   uint8             `tlb:"## 8"`
	DealID          uint64            `tlb:"## 64"`
	EventSequence   uint32            `tlb:"## 32"`
	EventType       uint8             `tlb:"## 4"`
	PreviousState   uint8             `tlb:"## 3"`
	NewState        uint8             `tlb:"## 3"`
	Actor           *address.Address  `tlb:"addr"`
	Counterparty    *address.Address  `tlb:"addr"`
	TermsHash       []byte            `tlb:"bits 256"`
	Decision        uint8             `tlb:"## 2"`
}

type escrowLifecycleEvent struct {
	SchemaVersion uint8  `json:"schemaVersion"`
	DealID        string `json:"dealId"`
	EventSequence uint32 `json:"eventSequence"`
	EventType     string `json:"eventType"`
	PreviousState string `json:"previousState"`
	NewState      string `json:"newState"`
	Actor         string `json:"actor"`
	Counterparty  string `json:"counterparty"`
	TermsHash     string `json:"termsHash"`
	Decision      string `json:"decision"`
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

func validateEscrowLifecycleEvent(event escrowLifecycleEvent) error {
	if event.DealID == "0" || event.EventSequence == 0 || event.TermsHash == strings.Repeat("0", 64) {
		return errors.New("invalid_escrow_event_identity")
	}
	if event.Actor == event.Counterparty {
		return errors.New("invalid_escrow_event_participants")
	}
	valid := false
	switch event.EventType {
	case "accepted":
		valid = event.PreviousState == "created" && event.NewState == "accepted" && event.Decision == "none"
	case "funded":
		valid = event.PreviousState == "accepted" && event.NewState == "funded" && event.Decision == "none"
	case "completion_marked":
		valid = event.PreviousState == "funded" && event.NewState == "funded" && event.Decision == "none"
	case "dispute_opened":
		valid = event.PreviousState == "funded" && event.NewState == "disputed" && event.Decision == "none"
	case "dispute_vote_recorded":
		valid = event.PreviousState == "disputed" && event.NewState == "disputed" &&
			(event.Decision == "release_to_seller" || event.Decision == "refund_to_buyer")
	case "mutual_dispute_resolved", "arbiter_dispute_resolved":
		valid = event.PreviousState == "disputed" &&
			((event.NewState == "released" && event.Decision == "release_to_seller") ||
				(event.NewState == "refunded" && event.Decision == "refund_to_buyer"))
	case "released":
		valid = event.PreviousState == "funded" && event.NewState == "released" && event.Decision == "release_to_seller"
	case "refunded":
		valid = event.PreviousState == "funded" && event.NewState == "refunded" && event.Decision == "refund_to_buyer"
	case "cancelled":
		valid = (event.PreviousState == "created" || event.PreviousState == "accepted") &&
			event.NewState == "cancelled" && event.Decision == "none"
	}
	if !valid {
		return errors.New("invalid_escrow_event_transition")
	}
	return nil
}

func parseEscrowLifecycleEvent(body *cell.Cell) (escrowLifecycleEvent, error) {
	var decoded escrowLifecycleEventBody
	if body == nil {
		return escrowLifecycleEvent{}, errors.New("empty_event_body")
	}
	if err := tlb.Parse(&decoded, body); err != nil {
		return escrowLifecycleEvent{}, fmt.Errorf("invalid_escrow_event_body: %w", err)
	}
	if decoded.SchemaVersion != 1 {
		return escrowLifecycleEvent{}, fmt.Errorf("unsupported_escrow_event_schema_version:%d", decoded.SchemaVersion)
	}
	eventTypes := map[uint8]string{
		1: "accepted",
		2: "funded",
		3: "completion_marked",
		4: "dispute_opened",
		5: "dispute_vote_recorded",
		6: "mutual_dispute_resolved",
		7: "arbiter_dispute_resolved",
		8: "released",
		9: "refunded",
		10: "cancelled",
	}
	states := map[uint8]string{
		0: "created",
		1: "accepted",
		2: "funded",
		3: "disputed",
		4: "released",
		5: "refunded",
		6: "cancelled",
	}
	decisions := map[uint8]string{
		0: "none",
		1: "release_to_seller",
		2: "refund_to_buyer",
	}
	eventType, ok := eventTypes[decoded.EventType]
	if !ok {
		return escrowLifecycleEvent{}, fmt.Errorf("unknown_escrow_event_type:%d", decoded.EventType)
	}
	previousState, ok := states[decoded.PreviousState]
	if !ok {
		return escrowLifecycleEvent{}, fmt.Errorf("unknown_previous_escrow_state:%d", decoded.PreviousState)
	}
	newState, ok := states[decoded.NewState]
	if !ok {
		return escrowLifecycleEvent{}, fmt.Errorf("unknown_new_escrow_state:%d", decoded.NewState)
	}
	decision, ok := decisions[decoded.Decision]
	if !ok {
		return escrowLifecycleEvent{}, fmt.Errorf("unknown_escrow_decision:%d", decoded.Decision)
	}
	if decoded.Actor == nil || decoded.Counterparty == nil || len(decoded.TermsHash) != 32 {
		return escrowLifecycleEvent{}, errors.New("incomplete_escrow_event_fields")
	}
	event := escrowLifecycleEvent{
		SchemaVersion: decoded.SchemaVersion,
		DealID:        strconv.FormatUint(decoded.DealID, 10),
		EventSequence: decoded.EventSequence,
		EventType:     eventType,
		PreviousState: previousState,
		NewState:      newState,
		Actor:         decoded.Actor.StringRaw(),
		Counterparty:  decoded.Counterparty.StringRaw(),
		TermsHash:     hex.EncodeToString(decoded.TermsHash),
		Decision:      decision,
	}
	if err := validateEscrowLifecycleEvent(event); err != nil {
		return escrowLifecycleEvent{}, err
	}
	return event, nil
}

func decodeEscrowLifecycleEvents(tx *tlb.Transaction) ([]escrowLifecycleEvent, []string) {
	if tx == nil || tx.IO.Out == nil {
		return nil, nil
	}
	messages, err := tx.IO.Out.ToSlice()
	if err != nil {
		return nil, []string{fmt.Sprintf("outgoing_messages_unavailable:%v", err)}
	}
	var events []escrowLifecycleEvent
	var decodeErrors []string
	for _, message := range messages {
		if message.MsgType != tlb.MsgTypeExternalOut {
			continue
		}
		external := message.AsExternalOut()
		if external.Body == nil {
			continue
		}
		slice, err := external.Body.BeginParse()
		if err != nil {
			decodeErrors = append(decodeErrors, "external_message_body_unreadable")
			continue
		}
		opcode, err := slice.LoadUInt(32)
		if err != nil || opcode != 0x445552E0 {
			continue
		}
		event, err := parseEscrowLifecycleEvent(external.Body)
		if err != nil {
			decodeErrors = append(decodeErrors, err.Error())
			continue
		}
		events = append(events, event)
	}
	return events, decodeErrors
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
	if account.Code != nil {
		result.CurrentAccountCodeHash = hex.EncodeToString(account.Code.Hash())
	}

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
				result.EscrowEvents, result.EventDecodeErrors = decodeEscrowLifecycleEvents(tx)
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
