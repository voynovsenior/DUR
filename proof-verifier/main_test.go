package main

import (
	"strings"
	"testing"
)

func TestParseRequestAcceptsTestnetRawAddress(t *testing.T) {
	input := `{"network":"testnet","address":"0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","lt":"123","hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}`
	req, addr, lt, hash, err := parseRequest(strings.NewReader(input))
	if err != nil {
		t.Fatal(err)
	}
	if req.MaxScan != defaultMaxScan || addr == nil || lt != 123 || len(hash) != 32 {
		t.Fatalf("unexpected parsed request: %#v, %v, %d, %d", req, addr, lt, len(hash))
	}
}

func TestParseRequestRejectsMainnet(t *testing.T) {
	input := `{"network":"mainnet","address":"0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","lt":"123","hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}`
	_, _, _, _, err := parseRequest(strings.NewReader(input))
	if err == nil || err.Error() != "unsupported_network_testnet_only" {
		t.Fatalf("expected testnet-only rejection, got %v", err)
	}
}

func TestParseRequestRejectsUnknownFields(t *testing.T) {
	input := `{"network":"testnet","address":"0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","lt":"123","hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","secret":"not-accepted"}`
	_, _, _, _, err := parseRequest(strings.NewReader(input))
	if err == nil {
		t.Fatal("expected unknown field rejection")
	}
}

func TestParseRequestRejectsUnsupportedWorkchain(t *testing.T) {
	input := `{"network":"testnet","address":"1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","lt":"123","hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}`
	_, _, _, _, err := parseRequest(strings.NewReader(input))
	if err == nil || err.Error() != "unsupported_workchain" {
		t.Fatalf("expected unsupported workchain rejection, got %v", err)
	}
}

func TestParseRequestRejectsTrailingJSON(t *testing.T) {
	input := `{"network":"testnet","address":"0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","lt":"123","hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"} {}`
	_, _, _, _, err := parseRequest(strings.NewReader(input))
	if err == nil || err.Error() != "unexpected_trailing_json" {
		t.Fatalf("expected trailing JSON rejection, got %v", err)
	}
}
