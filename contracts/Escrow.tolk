import "types"

contract Escrow {
    author: "DUR Protocol"
    version: "0.2.0"
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

fun emitLifecycleEvent(
    storage: Storage,
    eventType: EscrowEventType,
    previousState: EscrowState,
    actor: address,
    counterparty: address,
    decision: ResolutionVote,
) {
    var eventStorage = storage;
    assert (eventStorage.eventSequence < 0xFFFFFFFF) throw Errors.EventSequenceExhausted;
    eventStorage.eventSequence += 1;
    eventStorage.save();

    val extra = ExtraFields.fromCell(eventStorage.extra);
    val logMessage = createExternalLogMessage({
        dest: createAddressNone(),
        body: EscrowLifecycleEvent {
            schemaVersion: 1,
            dealId: extra.dealId,
            eventSequence: eventStorage.eventSequence,
            eventType,
            previousState,
            newState: eventStorage.state,
            actor,
            counterparty,
            termsHash: extra.termsHash,
            decision,
        },
    });
    logMessage.send(SEND_MODE_REGULAR);
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

            val previousState = storage.state;
            storage.state = EscrowState.Accepted;
            emitLifecycleEvent(
                storage,
                EscrowEventType.Accepted,
                previousState,
                in.senderAddress,
                storage.buyer,
                ResolutionVote.NoVote,
            );
        }
        Fund => {
            var storage = lazy Storage.load();
            assert (storage.state == EscrowState.Accepted) throw Errors.InvalidState;
            assert (in.senderAddress == storage.buyer) throw Errors.Unauthorized;
            val extra = ExtraFields.fromCell(storage.extra);
            assert (storage.amount > 0) throw Errors.InvalidTerms;
            assert (extra.dealId > 0) throw Errors.InvalidTerms;
            assert (extra.termsHash > 0) throw Errors.InvalidTerms;
            assert (
                storage.buyer != storage.seller && storage.buyer != storage.arbiter &&
                storage.seller != storage.arbiter
            ) throw Errors.InvalidTerms;
            assert (
                extra.fundingDeadline > 0 && extra.completionDeadline >= extra.fundingDeadline &&
                extra.disputeDeadline >= extra.completionDeadline
            ) throw Errors.InvalidTerms;
            assert (blockchain.now() <= extra.fundingDeadline) throw Errors.DeadlinePassed;
            assert (in.valueCoins == storage.amount) throw Errors.InvalidFundingValue;

            val previousState = storage.state;
            storage.state = EscrowState.Funded;
            emitLifecycleEvent(
                storage,
                EscrowEventType.Funded,
                previousState,
                in.senderAddress,
                storage.seller,
                ResolutionVote.NoVote,
            );
        }
        MarkComplete => {
            var storage = lazy Storage.load();
            assert (storage.state == EscrowState.Funded) throw Errors.InvalidState;
            assert (in.senderAddress == storage.seller) throw Errors.Unauthorized;
            val extra = ExtraFields.fromCell(storage.extra);
            assert (blockchain.now() <= extra.completionDeadline) throw Errors.DeadlinePassed;

            val previousState = storage.state;
            storage.completionMarked = true;
            emitLifecycleEvent(
                storage,
                EscrowEventType.CompletionMarked,
                previousState,
                in.senderAddress,
                storage.buyer,
                ResolutionVote.NoVote,
            );
        }
        ApproveRelease => {
            var storage = lazy Storage.load();
            assert (storage.state == EscrowState.Funded) throw Errors.InvalidState;
            assert (in.senderAddress == storage.buyer) throw Errors.Unauthorized;
            assert (storage.completionMarked) throw Errors.CompletionNotMarked;

            val previousState = storage.state;
            storage.state = EscrowState.Released;
            emitLifecycleEvent(
                storage,
                EscrowEventType.Released,
                previousState,
                in.senderAddress,
                storage.seller,
                ResolutionVote.ReleaseToSeller,
            );
            sendPayout(storage.seller, storage.amount);
        }
        OpenDispute => {
            var storage = lazy Storage.load();
            assert (storage.state == EscrowState.Funded) throw Errors.InvalidState;
            assert (
                in.senderAddress == storage.buyer || in.senderAddress == storage.seller
            ) throw Errors.Unauthorized;
            val extra = ExtraFields.fromCell(storage.extra);
            assert (blockchain.now() <= extra.disputeDeadline) throw Errors.DeadlinePassed;

            val previousState = storage.state;
            storage.state = EscrowState.Disputed;
            var counterparty = storage.buyer;
            if (in.senderAddress == storage.buyer) {
                counterparty = storage.seller;
            }
            emitLifecycleEvent(
                storage,
                EscrowEventType.DisputeOpened,
                previousState,
                in.senderAddress,
                counterparty,
                ResolutionVote.NoVote,
            );
        }
        VoteResolution => {
            var storage = lazy Storage.load();
            assert (storage.state == EscrowState.Disputed) throw Errors.InvalidState;
            assert (
                in.senderAddress == storage.buyer || in.senderAddress == storage.seller
            ) throw Errors.Unauthorized;
            assert (msg.decision != ResolutionVote.NoVote) throw Errors.InvalidResolution;

            if (in.senderAddress == storage.buyer) {
                storage.buyerVote = msg.decision;
            } else {
                storage.sellerVote = msg.decision;
            }

            val previousState = storage.state;
            var counterparty = storage.buyer;
            if (in.senderAddress == storage.buyer) {
                counterparty = storage.seller;
            }
            if (
                storage.buyerVote == storage.sellerVote &&
                storage.buyerVote != ResolutionVote.NoVote
            ) {
                if (storage.buyerVote == ResolutionVote.ReleaseToSeller) {
                    storage.state = EscrowState.Released;
                    emitLifecycleEvent(
                        storage,
                        EscrowEventType.MutualDisputeResolved,
                        previousState,
                        in.senderAddress,
                        counterparty,
                        storage.buyerVote,
                    );
                    sendPayout(storage.seller, storage.amount);
                } else {
                    storage.state = EscrowState.Refunded;
                    emitLifecycleEvent(
                        storage,
                        EscrowEventType.MutualDisputeResolved,
                        previousState,
                        in.senderAddress,
                        counterparty,
                        storage.buyerVote,
                    );
                    sendPayout(storage.buyer, storage.amount);
                }
            } else {
                emitLifecycleEvent(
                    storage,
                    EscrowEventType.DisputeVoteRecorded,
                    previousState,
                    in.senderAddress,
                    counterparty,
                    msg.decision,
                );
            }
        }
        ResolveDispute => {
            var storage = lazy Storage.load();
            assert (storage.state == EscrowState.Disputed) throw Errors.InvalidState;
            assert (in.senderAddress == storage.arbiter) throw Errors.Unauthorized;

            val previousState = storage.state;
            if (msg.paySeller) {
                storage.state = EscrowState.Released;
                emitLifecycleEvent(
                    storage,
                    EscrowEventType.ArbiterDisputeResolved,
                    previousState,
                    in.senderAddress,
                    storage.seller,
                    ResolutionVote.ReleaseToSeller,
                );
                sendPayout(storage.seller, storage.amount);
            } else {
                storage.state = EscrowState.Refunded;
                emitLifecycleEvent(
                    storage,
                    EscrowEventType.ArbiterDisputeResolved,
                    previousState,
                    in.senderAddress,
                    storage.buyer,
                    ResolutionVote.RefundToBuyer,
                );
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

            val previousState = storage.state;
            storage.state = EscrowState.Refunded;
            emitLifecycleEvent(
                storage,
                EscrowEventType.Refunded,
                previousState,
                in.senderAddress,
                storage.seller,
                ResolutionVote.RefundToBuyer,
            );
            sendPayout(storage.buyer, storage.amount);
        }
        ClaimAfterDeadline => {
            var storage = lazy Storage.load();
            assert (storage.state == EscrowState.Funded) throw Errors.InvalidState;
            assert (in.senderAddress == storage.seller) throw Errors.Unauthorized;
            assert (storage.completionMarked) throw Errors.CompletionNotMarked;
            val extra = ExtraFields.fromCell(storage.extra);
            assert (blockchain.now() > extra.disputeDeadline) throw Errors.DeadlinePassed;

            val previousState = storage.state;
            storage.state = EscrowState.Released;
            emitLifecycleEvent(
                storage,
                EscrowEventType.Released,
                previousState,
                in.senderAddress,
                storage.buyer,
                ResolutionVote.ReleaseToSeller,
            );
            sendPayout(storage.seller, storage.amount);
        }
        Cancel => {
            var storage = lazy Storage.load();
            assert (
                storage.state == EscrowState.Created || storage.state == EscrowState.Accepted
            ) throw Errors.InvalidState;
            assert (
                in.senderAddress == storage.buyer || in.senderAddress == storage.seller
            ) throw Errors.Unauthorized;

            val previousState = storage.state;
            storage.state = EscrowState.Cancelled;
            var counterparty = storage.buyer;
            if (in.senderAddress == storage.buyer) {
                counterparty = storage.seller;
            }
            emitLifecycleEvent(
                storage,
                EscrowEventType.Cancelled,
                previousState,
                in.senderAddress,
                counterparty,
                ResolutionVote.NoVote,
            );
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
