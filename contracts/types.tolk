enum EscrowState {
    Created = 0
    Accepted = 1
    Funded = 2
    Disputed = 3
    Released = 4
    Refunded = 5
    Cancelled = 6
}

enum Errors {
    InvalidMessage = 0xFFFF
    InvalidState = 1001
    Unauthorized = 1002
    DeadlinePassed = 1003
    InvalidFundingValue = 1004
    CompletionNotMarked = 1005
    InvalidResolution = 1006
    InvalidTerms = 1007
}

struct ExtraFields {
    dealId: uint64
    termsHash: uint256
    fundingDeadline: uint32
    completionDeadline: uint32
    disputeDeadline: uint32
}

struct Storage {
    buyer: address
    seller: address
    arbiter: address
    amount: coins
    state: EscrowState
    completionMarked: bool
    extra: cell
}

fun Storage.load(): Storage {
    return Storage.fromCell(contract.getData());
}

fun Storage.save(self) {
    contract.setData(self.toCell());
}

struct (0x44555201) Accept {}

struct (0x44555202) Fund {}

struct (0x44555203) MarkComplete {}

struct (0x44555204) ApproveRelease {}

struct (0x44555205) OpenDispute {}

struct (0x44555206) ResolveDispute {
    paySeller: bool
}

struct (0x44555207) Refund {}

struct (0x44555208) Cancel {}

struct (0x44555209) ClaimAfterDeadline {}

type AllowedMessage =
    | Accept
    | Fund
    | MarkComplete
    | ApproveRelease
    | OpenDispute
    | ResolveDispute
    | Refund
    | Cancel
    | ClaimAfterDeadline
