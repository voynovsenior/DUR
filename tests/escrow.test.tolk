import "@acton/emulation/network"
import "@acton/emulation/testing"
import "@acton/testing/expect"

import "@contracts/types"
import "@wrappers/Escrow.gen"

fun setupTest(): (Escrow, Treasury, Treasury, Treasury) {
    testing.setNow(1_000);

    val buyer = testing.treasury("buyer");
    val seller = testing.treasury("seller");
    val arbiter = testing.treasury("arbiter");

    val extra = ExtraFields {
        dealId: 1,
        termsHash: 0x1234,
        fundingDeadline: 2_000,
        completionDeadline: 3_000,
        disputeDeadline: 4_000,
    };

    val contract = Escrow.fromStorage({
        buyer: buyer.address,
        seller: seller.address,
        arbiter: arbiter.address,
        amount: grams("1"),
        state: EscrowState.Created,
        completionMarked: false,
        buyerVote: ResolutionVote.NoVote,
        sellerVote: ResolutionVote.NoVote,
        extra: extra.toCell(),
    });

    val deployResult = contract.deploy(buyer.address, { value: grams("0.5") });
    expect(deployResult).toHaveSuccessfulDeploy({ to: contract.address });

    return (contract, buyer, seller, arbiter);
}

get fun `test seller accepts and buyer funds exact amount`() {
    val (contract, buyer, seller, _) = setupTest();

    val accept = contract.sendAccept(seller.address, { value: grams("0.1") });
    expect(accept).toHaveSuccessfulTx<Accept>({
        from: seller.address,
        to: contract.address,
    });
    expect(contract.currentState()).toEqual(EscrowState.Accepted);

    val fund = contract.sendFund(buyer.address, { value: grams("1") });
    expect(fund).toHaveSuccessfulTx<Fund>({
        from: buyer.address,
        to: contract.address,
    });
    expect(contract.currentState()).toEqual(EscrowState.Funded);
}

get fun `test incorrect funding amount is rejected`() {
    val (contract, buyer, seller, _) = setupTest();

    val accept = contract.sendAccept(seller.address, { value: grams("0.1") });
    expect(accept).toHaveSuccessfulTx<Accept>({
        from: seller.address,
        to: contract.address,
    });

    val fund = contract.sendFund(buyer.address, { value: grams("0.9") });
    expect(fund).toHaveFailedTx({
        from: buyer.address,
        to: contract.address,
        exitCode: Errors.InvalidFundingValue,
    });
    expect(contract.currentState()).toEqual(EscrowState.Accepted);
}

get fun `test buyer releases funds only after seller marks completion`() {
    val (contract, buyer, seller, _) = setupTest();

    contract.sendAccept(seller.address, { value: grams("0.1") });
    contract.sendFund(buyer.address, { value: grams("1") });

    val premature = contract.sendApproveRelease(buyer.address, { value: grams("0.1") });
    expect(premature).toHaveFailedTx({
        from: buyer.address,
        to: contract.address,
        exitCode: Errors.CompletionNotMarked,
    });

    val completion = contract.sendMarkComplete(seller.address, { value: grams("0.1") });
    expect(completion).toHaveSuccessfulTx<MarkComplete>({
        from: seller.address,
        to: contract.address,
    });

    val release = contract.sendApproveRelease(buyer.address, { value: grams("0.1") });
    expect(release).toHaveSuccessfulTx<ApproveRelease>({
        from: buyer.address,
        to: contract.address,
    });
    expect(contract.currentState()).toEqual(EscrowState.Released);
}

get fun `test either participant can dispute and only arbiter can resolve`() {
    val (contract, buyer, seller, arbiter) = setupTest();

    contract.sendAccept(seller.address, { value: grams("0.1") });
    contract.sendFund(buyer.address, { value: grams("1") });

    val dispute = contract.sendOpenDispute(buyer.address, { value: grams("0.1") });
    expect(dispute).toHaveSuccessfulTx<OpenDispute>({
        from: buyer.address,
        to: contract.address,
    });
    expect(contract.currentState()).toEqual(EscrowState.Disputed);

    val unauthorized = contract.sendResolveDispute(seller.address, false, { value: grams("0.1") });
    expect(unauthorized).toHaveFailedTx({
        from: seller.address,
        to: contract.address,
        exitCode: Errors.Unauthorized,
    });

    val resolution = contract.sendResolveDispute(arbiter.address, false, { value: grams("0.1") });
    expect(resolution).toHaveSuccessfulTx<ResolveDispute>({
        from: arbiter.address,
        to: contract.address,
    });
    expect(contract.currentState()).toEqual(EscrowState.Refunded);
}

get fun `test buyer can refund after dispute deadline when completion was not marked`() {
    val (contract, buyer, seller, _) = setupTest();

    contract.sendAccept(seller.address, { value: grams("0.1") });
    contract.sendFund(buyer.address, { value: grams("1") });

    testing.setNow(4_001);
    val refund = contract.sendRefund(buyer.address, { value: grams("0.1") });
    expect(refund).toHaveSuccessfulTx<Refund>({
        from: buyer.address,
        to: contract.address,
    });
    expect(contract.currentState()).toEqual(EscrowState.Refunded);
}

get fun `test seller can claim after deadline when completion was marked and no dispute was opened`() {
    val (contract, buyer, seller, _) = setupTest();

    contract.sendAccept(seller.address, { value: grams("0.1") });
    contract.sendFund(buyer.address, { value: grams("1") });
    contract.sendMarkComplete(seller.address, { value: grams("0.1") });

    testing.setNow(4_001);
    val claim = contract.sendClaimAfterDeadline(seller.address, { value: grams("0.1") });
    expect(claim).toHaveSuccessfulTx<ClaimAfterDeadline>({
        from: seller.address,
        to: contract.address,
    });
    expect(contract.currentState()).toEqual(EscrowState.Released);
}

get fun `test zero terms hash is rejected before funding`() {
    testing.setNow(1_000);
    val buyer = testing.treasury("invalid-buyer");
    val seller = testing.treasury("invalid-seller");
    val arbiter = testing.treasury("invalid-arbiter");
    val extra = ExtraFields {
        dealId: 1,
        termsHash: 0,
        fundingDeadline: 2_000,
        completionDeadline: 3_000,
        disputeDeadline: 4_000,
    };
    val contract = Escrow.fromStorage({
        buyer: buyer.address,
        seller: seller.address,
        arbiter: arbiter.address,
        amount: grams("1"),
        state: EscrowState.Created,
        completionMarked: false,
        buyerVote: ResolutionVote.NoVote,
        sellerVote: ResolutionVote.NoVote,
        extra: extra.toCell(),
    });
    contract.deploy(buyer.address, { value: grams("0.5") });
    contract.sendAccept(seller.address, { value: grams("0.1") });

    val fund = contract.sendFund(buyer.address, { value: grams("1") });
    expect(fund).toHaveFailedTx({
        from: buyer.address,
        to: contract.address,
        exitCode: Errors.InvalidTerms,
    });
    expect(contract.currentState()).toEqual(EscrowState.Accepted);
}

get fun `test invalid deadline ordering is rejected before funding`() {
    testing.setNow(1_000);
    val buyer = testing.treasury("deadline-buyer");
    val seller = testing.treasury("deadline-seller");
    val arbiter = testing.treasury("deadline-arbiter");
    val extra = ExtraFields {
        dealId: 1,
        termsHash: 0x1234,
        fundingDeadline: 3_000,
        completionDeadline: 2_000,
        disputeDeadline: 4_000,
    };
    val contract = Escrow.fromStorage({
        buyer: buyer.address,
        seller: seller.address,
        arbiter: arbiter.address,
        amount: grams("1"),
        state: EscrowState.Created,
        completionMarked: false,
        buyerVote: ResolutionVote.NoVote,
        sellerVote: ResolutionVote.NoVote,
        extra: extra.toCell(),
    });
    contract.deploy(buyer.address, { value: grams("0.5") });
    contract.sendAccept(seller.address, { value: grams("0.1") });

    val fund = contract.sendFund(buyer.address, { value: grams("1") });
    expect(fund).toHaveFailedTx({
        from: buyer.address,
        to: contract.address,
        exitCode: Errors.InvalidTerms,
    });
    expect(contract.currentState()).toEqual(EscrowState.Accepted);
}

get fun `test seller acceptance is allowed exactly at the funding deadline`() {
    val (contract, _, seller, _) = setupTest();
    testing.setNow(2_000);

    val accept = contract.sendAccept(seller.address, { value: grams("0.1") });
    expect(accept).toHaveSuccessfulTx<Accept>({
        from: seller.address,
        to: contract.address,
    });
    expect(contract.currentState()).toEqual(EscrowState.Accepted);
}

get fun `test seller acceptance is rejected after the funding deadline`() {
    val (contract, _, seller, _) = setupTest();
    testing.setNow(2_001);

    val accept = contract.sendAccept(seller.address, { value: grams("0.1") });
    expect(accept).toHaveFailedTx({
        from: seller.address,
        to: contract.address,
        exitCode: Errors.DeadlinePassed,
    });
    expect(contract.currentState()).toEqual(EscrowState.Created);
}

get fun `test seller completion is allowed exactly at the completion deadline`() {
    val (contract, buyer, seller, _) = setupTest();
    contract.sendAccept(seller.address, { value: grams("0.1") });
    contract.sendFund(buyer.address, { value: grams("1") });
    testing.setNow(3_000);

    val completion = contract.sendMarkComplete(seller.address, { value: grams("0.1") });
    expect(completion).toHaveSuccessfulTx<MarkComplete>({
        from: seller.address,
        to: contract.address,
    });
    expect(contract.agreementDetails().completionMarked).toEqual(true);
}

get fun `test seller completion is rejected after the completion deadline`() {
    val (contract, buyer, seller, _) = setupTest();
    contract.sendAccept(seller.address, { value: grams("0.1") });
    contract.sendFund(buyer.address, { value: grams("1") });
    testing.setNow(3_001);

    val completion = contract.sendMarkComplete(seller.address, { value: grams("0.1") });
    expect(completion).toHaveFailedTx({
        from: seller.address,
        to: contract.address,
        exitCode: Errors.DeadlinePassed,
    });
    expect(contract.agreementDetails().completionMarked).toEqual(false);
}

get fun `test dispute is allowed exactly at the dispute deadline`() {
    val (contract, buyer, seller, _) = setupTest();
    contract.sendAccept(seller.address, { value: grams("0.1") });
    contract.sendFund(buyer.address, { value: grams("1") });
    testing.setNow(4_000);

    val dispute = contract.sendOpenDispute(buyer.address, { value: grams("0.1") });
    expect(dispute).toHaveSuccessfulTx<OpenDispute>({
        from: buyer.address,
        to: contract.address,
    });
    expect(contract.currentState()).toEqual(EscrowState.Disputed);
}

get fun `test dispute is rejected after the dispute deadline`() {
    val (contract, buyer, seller, _) = setupTest();
    contract.sendAccept(seller.address, { value: grams("0.1") });
    contract.sendFund(buyer.address, { value: grams("1") });
    testing.setNow(4_001);

    val dispute = contract.sendOpenDispute(buyer.address, { value: grams("0.1") });
    expect(dispute).toHaveFailedTx({
        from: buyer.address,
        to: contract.address,
        exitCode: Errors.DeadlinePassed,
    });
    expect(contract.currentState()).toEqual(EscrowState.Funded);
}

get fun `test buyer refund is unavailable at the dispute deadline but allowed after it`() {
    val (contract, buyer, seller, _) = setupTest();
    contract.sendAccept(seller.address, { value: grams("0.1") });
    contract.sendFund(buyer.address, { value: grams("1") });
    testing.setNow(4_000);

    val atDeadline = contract.sendRefund(buyer.address, { value: grams("0.1") });
    expect(atDeadline).toHaveFailedTx({
        from: buyer.address,
        to: contract.address,
        exitCode: Errors.DeadlinePassed,
    });
    expect(contract.currentState()).toEqual(EscrowState.Funded);

    testing.setNow(4_001);
    val afterDeadline = contract.sendRefund(buyer.address, { value: grams("0.1") });
    expect(afterDeadline).toHaveSuccessfulTx<Refund>({
        from: buyer.address,
        to: contract.address,
    });
    expect(contract.currentState()).toEqual(EscrowState.Refunded);
}

get fun `test terminal payout cannot be triggered a second time`() {
    val (contract, buyer, seller, _) = setupTest();
    contract.sendAccept(seller.address, { value: grams("0.1") });
    contract.sendFund(buyer.address, { value: grams("1") });
    contract.sendMarkComplete(seller.address, { value: grams("0.1") });

    val release = contract.sendApproveRelease(buyer.address, { value: grams("0.1") });
    expect(release).toHaveSuccessfulTx<ApproveRelease>({
        from: buyer.address,
        to: contract.address,
    });
    expect(contract.currentState()).toEqual(EscrowState.Released);

    val duplicate = contract.sendApproveRelease(buyer.address, { value: grams("0.1") });
    expect(duplicate).toHaveFailedTx({
        from: buyer.address,
        to: contract.address,
        exitCode: Errors.InvalidState,
    });
    expect(contract.currentState()).toEqual(EscrowState.Released);
}

get fun `test both parties can mutually release a disputed agreement`() {
    val (contract, buyer, seller, _) = setupTest();
    contract.sendAccept(seller.address, { value: grams("0.1") });
    contract.sendFund(buyer.address, { value: grams("1") });
    contract.sendOpenDispute(buyer.address, { value: grams("0.1") });

    val buyerVote = contract.sendVoteResolution(
        buyer.address,
        ResolutionVote.ReleaseToSeller,
        { value: grams("0.1") },
    );
    expect(buyerVote).toHaveSuccessfulTx<VoteResolution>({
        from: buyer.address,
        to: contract.address,
    });
    expect(contract.currentState()).toEqual(EscrowState.Disputed);

    val sellerVote = contract.sendVoteResolution(
        seller.address,
        ResolutionVote.ReleaseToSeller,
        { value: grams("0.1") },
    );
    expect(sellerVote).toHaveSuccessfulTx<VoteResolution>({
        from: seller.address,
        to: contract.address,
    });
    expect(contract.currentState()).toEqual(EscrowState.Released);
}

get fun `test conflicting dispute votes remain pending until both parties agree`() {
    val (contract, buyer, seller, _) = setupTest();
    contract.sendAccept(seller.address, { value: grams("0.1") });
    contract.sendFund(buyer.address, { value: grams("1") });
    contract.sendOpenDispute(seller.address, { value: grams("0.1") });

    contract.sendVoteResolution(
        buyer.address,
        ResolutionVote.ReleaseToSeller,
        { value: grams("0.1") },
    );
    contract.sendVoteResolution(
        seller.address,
        ResolutionVote.RefundToBuyer,
        { value: grams("0.1") },
    );
    expect(contract.currentState()).toEqual(EscrowState.Disputed);

    val updatedVote = contract.sendVoteResolution(
        buyer.address,
        ResolutionVote.RefundToBuyer,
        { value: grams("0.1") },
    );
    expect(updatedVote).toHaveSuccessfulTx<VoteResolution>({
        from: buyer.address,
        to: contract.address,
    });
    expect(contract.currentState()).toEqual(EscrowState.Refunded);
}

get fun `test only the buyer or seller can submit a mutual dispute vote`() {
    val (contract, buyer, seller, _) = setupTest();
    val stranger = testing.treasury("stranger");
    contract.sendAccept(seller.address, { value: grams("0.1") });
    contract.sendFund(buyer.address, { value: grams("1") });
    contract.sendOpenDispute(buyer.address, { value: grams("0.1") });

    val unauthorized = contract.sendVoteResolution(
        stranger.address,
        ResolutionVote.ReleaseToSeller,
        { value: grams("0.1") },
    );
    expect(unauthorized).toHaveFailedTx({
        from: stranger.address,
        to: contract.address,
        exitCode: Errors.Unauthorized,
    });
    expect(contract.currentState()).toEqual(EscrowState.Disputed);
}

get fun `test no-vote value is rejected during an active dispute`() {
    val (contract, buyer, seller, _) = setupTest();
    contract.sendAccept(seller.address, { value: grams("0.1") });
    contract.sendFund(buyer.address, { value: grams("1") });
    contract.sendOpenDispute(buyer.address, { value: grams("0.1") });

    val invalidVote = contract.sendVoteResolution(
        buyer.address,
        ResolutionVote.NoVote,
        { value: grams("0.1") },
    );
    expect(invalidVote).toHaveFailedTx({
        from: buyer.address,
        to: contract.address,
        exitCode: Errors.InvalidResolution,
    });
    expect(contract.currentState()).toEqual(EscrowState.Disputed);
}

get fun `test mutual resolution vote is unavailable before a dispute`() {
    val (contract, buyer, seller, _) = setupTest();
    contract.sendAccept(seller.address, { value: grams("0.1") });
    contract.sendFund(buyer.address, { value: grams("1") });

    val vote = contract.sendVoteResolution(
        buyer.address,
        ResolutionVote.ReleaseToSeller,
        { value: grams("0.1") },
    );
    expect(vote).toHaveFailedTx({
        from: buyer.address,
        to: contract.address,
        exitCode: Errors.InvalidState,
    });
    expect(contract.currentState()).toEqual(EscrowState.Funded);
}
