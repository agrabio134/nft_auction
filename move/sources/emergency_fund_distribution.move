#[allow(unused_use, unused_field)]
module lofita_yeti_auction::emergency_fund_release {
    use sui::object::{Self, UID, ID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};

    // Reference the original Auction struct from package 0x3d456...
    struct Auction has key, store {
        id: UID,
        nft_id: ID,
        kiosk_id: ID,
        starting_bid: u64,
        current_bid: u64,
        highest_bidder: address,
        seller: address,
        end_time: u64,
        status: u8,
        balance: Balance<SUI>,
    }

    const FEE_ADDRESS: address = @0x8cfed3962605beacf459a4bab2830a7c8e95bab8e60c228e65b2837565bd5fb8;

    public entry fun release_funds(
        auction: &mut Auction,
        ctx: &mut TxContext
    ) {
        assert!(auction.status == 0, 1); // Ensure auction is active
        auction.status = 1; // Mark as ended
        if (auction.highest_bidder != @0x0) {
            let fee_amount = auction.current_bid / 100; // 1% fee
            let seller_amount = auction.current_bid - fee_amount;
            // Transfer payment to seller
            let seller_payment = coin::take(&mut auction.balance, seller_amount, ctx);
            transfer::public_transfer(seller_payment, auction.seller);
            // Transfer fee
            let fee_payment = coin::take(&mut auction.balance, fee_amount, ctx);
            transfer::public_transfer(fee_payment, FEE_ADDRESS);
        };
        let remaining_balance = balance::split(&mut auction.balance, 0);
        balance::destroy_zero(remaining_balance);
    }
}