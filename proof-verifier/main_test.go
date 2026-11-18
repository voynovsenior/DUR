package main

import (
	"encoding/hex"
	"strings"
	"testing"

	"github.com/xssnick/tonutils-go/address"
	"github.com/xssnick/tonutils-go/tlb"
	"github.com/xssnick/tonutils-go/tvm/cell"
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


func TestParseEscrowLifecycleEvent(t *testing.T) {
	actor, err := address.ParseRawAddr("0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	if err != nil {
		t.Fatal(err)
	}
	counterparty, err := address.ParseRawAddr("0:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
	if err != nil {
		t.Fatal(err)
	}
	termsHash, err := hex.DecodeString("cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc")
	if err != nil {
		t.Fatal(err)
	}

	body := escrowLifecycleEventBody{
		SchemaVersion: 1,
		DealID:        42,
		EventSequence: 7,
		EventType:     6,
		PreviousState: 3,
		NewState:      4,
		Actor:         actor,
		Counterparty:  counterparty,
		TermsHash:     termsHash,
		Decision:      1,
	}
	eventCell, err := tlb.ToCell(body)
	if err != nil {
		t.Fatal(err)
	}
	event, err := parseEscrowLifecycleEvent(eventCell)
	if err != nil {
		t.Fatal(err)
	}
	if event.SchemaVersion != 1 || event.DealID != "42" || event.EventSequence != 7 {
		t.Fatalf("unexpected event identity: %#v", event)
	}
	if event.EventType != "mutual_dispute_resolved" || event.PreviousState != "disputed" || event.NewState != "released" {
		t.Fatalf("unexpected event transition: %#v", event)
	}
	if event.Actor != actor.StringRaw() || event.Counterparty != counterparty.StringRaw() {
		t.Fatalf("unexpected event participants: %#v", event)
	}
	if event.TermsHash != hex.EncodeToString(termsHash) || event.Decision != "release_to_seller" {
		t.Fatalf("unexpected event terms/decision: %#v", event)
	}
}


func TestValidateEscrowLifecycleEventRejectsImpossibleTransition(t *testing.T) {
	event := escrowLifecycleEvent{
		SchemaVersion: 1,
		DealID: "42",
		EventSequence: 2,
		EventType: "funded",
		PreviousState: "created",
		NewState: "released",
		Actor: "0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		Counterparty: "0:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		TermsHash: strings.Repeat("c", 64),
		Decision: "release_to_seller",
	}
	if err := validateEscrowLifecycleEvent(event); err == nil || err.Error() != "invalid_escrow_event_transition" {
		t.Fatalf("expected impossible transition rejection, got %v", err)
	}
}

func TestValidateEscrowLifecycleEventRejectsZeroIdentityAndSameParticipants(t *testing.T) {
	event := escrowLifecycleEvent{
		SchemaVersion: 1,
		DealID: "0",
		EventSequence: 0,
		EventType: "accepted",
		PreviousState: "created",
		NewState: "accepted",
		Actor: "0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		Counterparty: "0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		TermsHash: strings.Repeat("0", 64),
		Decision: "none",
	}
	if err := validateEscrowLifecycleEvent(event); err == nil || err.Error() != "invalid_escrow_event_identity" {
		t.Fatalf("expected invalid event identity rejection, got %v", err)
	}
	event.DealID = "42"
	event.EventSequence = 1
	event.TermsHash = strings.Repeat("c", 64)
	if err := validateEscrowLifecycleEvent(event); err == nil || err.Error() != "invalid_escrow_event_participants" {
		t.Fatalf("expected same participant rejection, got %v", err)
	}
}

func TestParseEscrowLifecycleEventRejectsUnknownVersion(t *testing.T) {
	actor, _ := address.ParseRawAddr("0:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	counterparty, _ := address.ParseRawAddr("0:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
	termsHash := make([]byte, 32)
	body := escrowLifecycleEventBody{
		SchemaVersion: 2,
		DealID:        1,
		EventSequence: 1,
		EventType:     1,
		PreviousState: 0,
		NewState:      1,
		Actor:         actor,
		Counterparty:  counterparty,
		TermsHash:     termsHash,
		Decision:      0,
	}
	eventCell, err := tlb.ToCell(body)
	if err != nil {
		t.Fatal(err)
	}
	_, err = parseEscrowLifecycleEvent(eventCell)
	if err == nil || err.Error() != "unsupported_escrow_event_schema_version:2" {
		t.Fatalf("expected unsupported version error, got %v", err)
	}
}

func TestParseEscrowLifecycleEventRejectsMalformedBody(t *testing.T) {
	body := cell.BeginCell().MustStoreUInt(0x445552E0, 32).EndCell()
	_, err := parseEscrowLifecycleEvent(body)
	if err == nil {
		t.Fatal("expected malformed event body rejection")
	}
}

