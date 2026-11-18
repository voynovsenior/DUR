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
