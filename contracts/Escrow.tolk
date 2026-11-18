import "types"

contract Escrow {
    author: "DUR Protocol"
    version: "0.1.0"
    description: "Testnet-only TON escrow lifecycle prototype"
    storage: Storage
    incomingMessages: AllowedMessage
}

fun sendPayout(recipient: address, amount: coins) {
    val payout = createMessage({
        bounce: BounceMode.NoBounce,
        value: amount,
        dest: recipient,
    });
    payout.send(SEND_MODE_REGULAR);
}

fun onInternalMessage(in: InMessage) {
    val msg = lazy AllowedMessage.fromSlice(in.body);

    match (msg) {
        Accept => {
            var storage = lazy Storage.load();
            assert (storage.state == EscrowState.Created) throw Errors.InvalidState;
            assert (in.senderAddress == storage.seller) throw Errors.Unauthorized;
            val extra = ExtraFields.fromCell(storage.extra);
            assert (blockchain.now() <= extra.fundingDeadline) throw Errors.DeadlinePassed;

            storage.state = EscrowState.Accepted;
            storage.save();
        }
        Fund => {
            var storage = lazy Storage.load();
            assert (storage.state == EscrowState.Accepted) throw Errors.InvalidState;
            assert (in.senderAddress == storage.buyer) throw Errors.Unauthorized;
            val extra = ExtraFields.fromCell(storage.extra);
            assert (blockchain.now() <= extra.fundingDeadline) throw Errors.DeadlinePassed;
            assert (in.valueCoins == storage.amount) throw Errors.InvalidFundingValue;

            storage.state = EscrowState.Funded;
            storage.save();
        }
        MarkComplete => {
            var storage = lazy Storage.load();
            assert (storage.state == EscrowState.Funded) throw Errors.InvalidState;
            assert (in.senderAddress == storage.seller) throw Errors.Unauthorized;
            val extra = ExtraFields.fromCell(storage.extra);
            assert (blockchain.now() <= extra.completionDeadline) throw Errors.DeadlinePassed;

            storage.completionMarked = true;
            storage.save();
        }
        ApproveRelease => {
            var storage = lazy Storage.load();
            assert (storage.state == EscrowState.Funded) throw Errors.InvalidState;
            assert (in.senderAddress == storage.buyer) throw Errors.Unauthorized;
            assert (storage.completionMarked) throw Errors.CompletionNotMarked;

            storage.state = EscrowState.Released;
            storage.save();
            sendPayout(storage.seller, storage.amount);
        }
        OpenDispute => {
            var storage = lazy Storage.load();
            assert (storage.state == EscrowState.Funded) throw Errors.InvalidState;
            assert (
                in.senderAddress == storage.buyer ||
                in.senderAddress == storage.seller
            ) throw Errors.Unauthorized;
            val extra = ExtraFields.fromCell(storage.extra);
            assert (blockchain.now() <= extra.disputeDeadline) throw Errors.DeadlinePassed;

            storage.state = EscrowState.Disputed;
            storage.save();
        }
        ResolveDispute => {
            var storage = lazy Storage.load();
            assert (storage.state == EscrowState.Disputed) throw Errors.InvalidState;
            assert (in.senderAddress == storage.arbiter) throw Errors.Unauthorized;

            if (msg.paySeller) {
                storage.state = EscrowState.Released;
                storage.save();
                sendPayout(storage.seller, storage.amount);
            } else {
                storage.state = EscrowState.Refunded;
                storage.save();
                sendPayout(storage.buyer, storage.amount);
            }
        }
        Refund => {
            var storage = lazy Storage.load();
            assert (storage.state == EscrowState.Funded) throw Errors.InvalidState;
            assert (in.senderAddress == storage.buyer) throw Errors.Unauthorized;
            assert (!storage.completionMarked) throw Errors.InvalidState;
            val extra = ExtraFields.fromCell(storage.extra);
            assert (blockchain.now() > extra.disputeDeadline) throw Errors.DeadlinePassed;

            storage.state = EscrowState.Refunded;
            storage.save();
            sendPayout(storage.buyer, storage.amount);
        }
        ClaimAfterDeadline => {
            var storage = lazy Storage.load();
            assert (storage.state == EscrowState.Funded) throw Errors.InvalidState;
            assert (in.senderAddress == storage.seller) throw Errors.Unauthorized;
            assert (storage.completionMarked) throw Errors.CompletionNotMarked;
            val extra = ExtraFields.fromCell(storage.extra);
            assert (blockchain.now() > extra.disputeDeadline) throw Errors.DeadlinePassed;

            storage.state = EscrowState.Released;
            storage.save();
            sendPayout(storage.seller, storage.amount);
        }
        Cancel => {
            var storage = lazy Storage.load();
            assert (
                storage.state == EscrowState.Created ||
                storage.state == EscrowState.Accepted
            ) throw Errors.InvalidState;
            assert (
                in.senderAddress == storage.buyer ||
                in.senderAddress == storage.seller
            ) throw Errors.Unauthorized;

            storage.state = EscrowState.Cancelled;
            storage.save();
        }
        else => {
            assert (in.body.isEmpty()) throw Errors.InvalidMessage;
        }
    }
}

fun onBouncedMessage(_in: InMessageBounced) {}

get fun currentState(): EscrowState {
    val storage = lazy Storage.load();
    return storage.state;
}

get fun agreementDetails(): Storage {
    return Storage.load();
}

get fun agreementTerms(): ExtraFields {
    val storage = lazy Storage.load();
    return ExtraFields.fromCell(storage.extra);
}
