module 0x0::emergency_recovery {
    use 0x2::transfer;
    use 0x2::coin;
    use 0x2::balance;
    use 0x2::sui::SUI;
    use 0x2::tx_context::TxContext;

    // Define the legacy Auction struct to match 0x3d456324b6353a455807b9ff60f5112b2208895da4f21c99692ba8ac9d700d8d::marketplace::Auction
    #[allow(unused_field)]
    struct LegacyAuction has key, store {
        id: 0x2::object::UID,
        nft_id: 0x2::object::ID,
        kiosk_id: 0x2::object::ID,
        starting_bid: u64,
        current_bid: u64,
        highest_bidder: address,
        seller: address,
        end_time: u64,
        status: u8,
        balance: balance::Balance<SUI>,
    }

    // Emergency function to recover funds from a legacy auction object
    public entry fun recover_funds(auction: &mut LegacyAuction, ctx: &mut TxContext) {
        auction.status = 1;
        let amount = balance::value(&auction.balance);
        if (amount > 0 && auction.highest_bidder != @0x0) {
            let fee = amount / 100;
            transfer::public_transfer(
                coin::take(&mut auction.balance, amount - fee, ctx),
                auction.seller
            );
            transfer::public_transfer(
                coin::take(&mut auction.balance, fee, ctx),
                @0x8cfed3962605beacf459a4bab2830a7c8e95bab8e60c228e65b2837565bd5fb8
            );
        };
        balance::destroy_zero(balance::split(&mut auction.balance, 0));
    }
}