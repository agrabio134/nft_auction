#[allow(unused_const)]
module lofita_yeti_auction::marketplace {
    use sui::object::{Self, UID, ID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::clock::{Self, Clock};
    use sui::event;
    use sui::balance::{Self, Balance};
    use sui::kiosk::{Self, Kiosk, KioskOwnerCap};
    use sui::transfer_policy::{Self, TransferPolicy};

    // Shared kiosk ID (for reference, not used in deposit)
    const SHARED_KIOSK_ID: address = @0x88411ccf93211de8e5f2a6416e4db21de4a0d69fc308a2a72e970ff05758a083;

    // Admin address to receive deposited NFTs
    const ADMIN_ADDRESS: address = @0x3a74d8e94bf49bb738a3f1dedcc962ed01c89f78d21c01d87ee5e6980f0750e9; // Replace with actual admin address

    // Generic NFT struct
    #[allow(unused_field)]
    struct NFT has key, store {
        id: UID,
        collection_id: vector<u8>,
        token_id: vector<u8>,
    }

    struct Auction has key, store {
        id: UID,
        nft_id: ID,
        kiosk_id: ID,
        starting_bid: u64, // In MIST
        current_bid: u64,
        highest_bidder: address,
        seller: address,
        end_time: u64, // In milliseconds
        status: u8, // 0: Active, 1: Ended, 2: Cancelled
        balance: Balance<SUI>,
    }

    struct AuctionCreated has copy, drop {
        auction_id: ID,
        nft_id: ID,
        kiosk_id: ID,
        starting_bid: u64,
        seller: address,
        end_time: u64,
    }

    struct BidPlaced has copy, drop {
        auction_id: ID,
        bidder: address,
        amount: u64,
    }

    struct AuctionEnded has copy, drop {
        auction_id: ID,
        winner: address,
        final_bid: u64,
    }

    struct NFTPlaced has copy, drop {
        nft_id: ID,
        kiosk_id: ID,
        seller: address,
    }

    struct NFTDeposited has copy, drop {
        nft_id: ID,
        seller: address,
        admin: address,
    }

    // Errors
    const EAuctionNotActive: u64 = 1;
    const EAuctionEnded: u64 = 2;
    const EInvalidBid: u64 = 3;
    const EAuctionNotEnded: u64 = 4;
    const ENotKioskOwner: u64 = 5;

    // Fee address
    const FEE_ADDRESS: address = @0x8cfed3962605beacf459a4bab2830a7c8e95bab8e60c228e65b2837565bd5fb8;

    // Deposit an NFT to the admin address for auction processing
    public entry fun deposit_nft_to_admin<T: key + store>(
        nft: T,
        ctx: &mut TxContext
    ) {
        let seller = tx_context::sender(ctx);
        let nft_id = object::id(&nft);
        // Transfer the NFT to the admin address
        transfer::public_transfer(nft, ADMIN_ADDRESS);
        event::emit(NFTDeposited {
            nft_id,
            seller,
            admin: ADMIN_ADDRESS,
        });
    }

    // Place an NFT in a user-owned kiosk
    public entry fun place_nft<T: key + store>(
        kiosk: &mut Kiosk,
        kiosk_cap: &KioskOwnerCap,
        nft: T,
        ctx: &mut TxContext
    ) {
        let seller = tx_context::sender(ctx);
        let nft_id = object::id(&nft);
        let kiosk_id = object::id(kiosk);
        // Verify the kiosk_cap matches the kiosk
        assert!(kiosk::has_access(kiosk, kiosk_cap), ENotKioskOwner);
        // Place the NFT in the kiosk
        kiosk::place(kiosk, kiosk_cap, nft);
        event::emit(NFTPlaced {
            nft_id,
            kiosk_id,
            seller,
        });
    }

    // List an NFT for auction from a shared kiosk
    public entry fun list_nft<T: key + store>(
        kiosk: &mut Kiosk,
        kiosk_cap: &KioskOwnerCap,
        nft_id: ID,
        starting_bid: u64,
        duration_ms: u64,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        let seller = tx_context::sender(ctx);
        let kiosk_id = object::id(kiosk);
        // Verify the kiosk_cap matches the kiosk
        assert!(kiosk::has_access(kiosk, kiosk_cap), ENotKioskOwner);
        // Lock the NFT to prevent external actions
        kiosk::list<T>(kiosk, kiosk_cap, nft_id, starting_bid);
        let auction = Auction {
            id: object::new(ctx),
            nft_id,
            kiosk_id,
            starting_bid,
            current_bid: starting_bid,
            highest_bidder: @0x0,
            seller,
            end_time: clock::timestamp_ms(clock) + duration_ms,
            status: 0,
            balance: balance::zero<SUI>(),
        };
        event::emit(AuctionCreated {
            auction_id: object::uid_to_inner(&auction.id),
            nft_id,
            kiosk_id,
            starting_bid,
            seller,
            end_time: auction.end_time,
        });
        transfer::share_object(auction);
    }

    // Place a bid on an auction
    public entry fun place_bid(
        auction: &mut Auction,
        bid: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(auction.status == 0, EAuctionNotActive);
        assert!(clock::timestamp_ms(clock) < auction.end_time, EAuctionEnded);
        let bid_amount = coin::value(&bid);
        assert!(bid_amount > auction.current_bid, EInvalidBid);
        let bidder = tx_context::sender(ctx);
        if (auction.highest_bidder != @0x0) {
            let refund = coin::take(&mut auction.balance, auction.current_bid, ctx);
            transfer::public_transfer(refund, auction.highest_bidder);
        };
        auction.current_bid = bid_amount;
        auction.highest_bidder = bidder;
        balance::join(&mut auction.balance, coin::into_balance(bid));
        event::emit(BidPlaced {
            auction_id: object::uid_to_inner(&auction.id),
            bidder,
            amount: bid_amount,
        });
    }

    // End an auction and transfer NFT to winner
    public entry fun end_auction<T: key + store>(
        auction: &mut Auction,
        kiosk: &mut Kiosk,
        kiosk_cap: &KioskOwnerCap,
        policy: &TransferPolicy<T>,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(auction.status == 0, EAuctionNotActive);
        assert!(clock::timestamp_ms(clock) >= auction.end_time, EAuctionNotEnded);
        auction.status = 1;
        if (auction.highest_bidder != @0x0) {
            // Purchase the NFT from the kiosk
            let payment = coin::take(&mut auction.balance, auction.current_bid, ctx);
            let fee_amount = auction.current_bid * 75 / 1000; // 7.5% fee
            let seller_amount = auction.current_bid - fee_amount;
            let (nft, request) = kiosk::purchase<T>(kiosk, auction.nft_id, payment);
            transfer_policy::confirm_request(policy, request);
            // Transfer NFT to winner
            transfer::public_transfer(nft, auction.highest_bidder);
            // Transfer payment to seller
            let seller_payment = coin::take(&mut auction.balance, seller_amount, ctx);
            transfer::public_transfer(seller_payment, auction.seller);
            // Transfer fee
            let fee_payment = coin::take(&mut auction.balance, fee_amount, ctx);
            transfer::public_transfer(fee_payment, FEE_ADDRESS);
            event::emit(AuctionEnded {
                auction_id: object::uid_to_inner(&auction.id),
                winner: auction.highest_bidder,
                final_bid: auction.current_bid,
            });
        } else {
            // Delist and unlock NFT to seller
            kiosk::delist<T>(kiosk, kiosk_cap, auction.nft_id);
            let nft = kiosk::take<T>(kiosk, kiosk_cap, auction.nft_id);
            transfer::public_transfer(nft, auction.seller);
        };
        let remaining_balance = balance::split(&mut auction.balance, 0);
        balance::destroy_zero(remaining_balance);
    }

    // End an auction without NFT transfer
    public entry fun end_auction_no_transfer(
        auction: &mut Auction,
        clock: &Clock,
        ctx: &mut TxContext
    ) {
        assert!(auction.status == 0, EAuctionNotActive);
        assert!(clock::timestamp_ms(clock) >= auction.end_time, EAuctionNotEnded);
        auction.status = 1;
        if (auction.highest_bidder != @0x0) {
            let fee_amount = auction.current_bid * 75 / 1000; // 7.5% fee
            let seller_amount = auction.current_bid - fee_amount;
            // Transfer payment to seller
            let seller_payment = coin::take(&mut auction.balance, seller_amount, ctx);
            transfer::public_transfer(seller_payment, auction.seller);
            // Transfer fee
            let fee_payment = coin::take(&mut auction.balance, fee_amount, ctx);
            transfer::public_transfer(fee_payment, FEE_ADDRESS);
            event::emit(AuctionEnded {
                auction_id: object::uid_to_inner(&auction.id),
                winner: auction.highest_bidder,
                final_bid: auction.current_bid,
            });
        };
        let remaining_balance = balance::split(&mut auction.balance, 0);
        balance::destroy_zero(remaining_balance);
    }
}