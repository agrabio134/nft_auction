import React, { useState, useEffect } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { useWallet, ConnectButton } from '@suiet/wallet-kit';
import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { Box, Alert, CircularProgress, Typography, Card, CardMedia, CardContent, Divider, TextField, Button, Link } from '@mui/material';
import * as Sentry from '@sentry/react';
import QueuedAuctionCard from './QueuedAuctionCard';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);
const auth = getAuth(app);

const MAINNET_URL = getFullnodeUrl('mainnet');
const suiClient = new SuiClient({ url: MAINNET_URL });

const SHARED_KIOSK_ID = '0x88411ccf93211de8e5f2a6416e4db21de4a0d69fc308a2a72e970ff05758a083';
const KIOSK_OWNER_CAP_ID = '0x5c04a377c1e8c8c54c200db56083cc93eb46243ad4c2cf5b90c4aaef8500cfee';
const ADMIN_ADDRESS = '0x3a74d8e94bf49bb738a3f1dedcc962ed01c89f78d21c01d87ee5e6980f0750e9';
const PACKAGE_ID = '0xe698a87c127715a2a7606fcc7550d96daf082ccb398c95fb1f4d73104aefb6c8';

function LiveAuction() {
  const wallet = useWallet();
  const [liveAuction, setLiveAuction] = useState(null);
  const [queuedAuctions, setQueuedAuctions] = useState([]);
  const [completedAuctions, setCompletedAuctions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [completedError, setCompletedError] = useState('');
  const [success, setSuccess] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentBid, setCurrentBid] = useState(0);
  const [highestBidderDisplay, setHighestBidderDisplay] = useState('None');
  const [bidHistory, setBidHistory] = useState([]);
  const [timeLeft, setTimeLeft] = useState('N/A');
  const [isAuctionEnded, setIsAuctionEnded] = useState(false);
  const [bidAmount, setBidAmount] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState(null);
  const [isBidding, setIsBidding] = useState(false);

  useEffect(() => {
    const trySignInAnonymously = async () => {
      if (!isAuthenticated) {
        try {
          await signInAnonymously(auth);
          console.log('Firebase authentication successful');
        } catch (err) {
          console.error('Firebase auth failed:', err.message, err.stack);
          setError('Unable to connect to Firebase. Please try again later.');
          Sentry.captureException(err);
          setIsLoading(false);
        }
      }
    };

    trySignInAnonymously();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
      if (user) {
        console.log('User authenticated, fetching auctions');
        fetchLiveAuction();
        fetchQueuedAuctions();
        fetchCompletedAuctions();
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    console.log('completedAuctions state updated:', completedAuctions);
  }, [completedAuctions]);

  const withRetry = async (operation, maxAttempts = 5, isFirestore = false) => {
    let attempts = 0;
    while (attempts < maxAttempts) {
      try {
        return await operation();
      } catch (err) {
        attempts++;
        console.warn(`Operation failed (attempt ${attempts}/${maxAttempts}): ${err.message}`);
        if (attempts === maxAttempts) {
          if (isFirestore) return null;
          throw new Error(`Operation failed after ${maxAttempts} attempts: ${err.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
      }
    }
  };

  const checkWalletBalance = async (requiredGas) => {
    try {
      const balance = await withRetry(() => suiClient.getBalance({ owner: wallet.account?.address }));
      const availableGas = parseInt(balance.totalBalance);
      return availableGas >= requiredGas;
    } catch (err) {
      console.error('Balance check failed:', err.message);
      return false;
    }
  };

  const estimateGasBudget = async (tx) => {
    try {
      const dryRun = await withRetry(() => suiClient.dryRunTransactionBlock({ transactionBlock: tx }));
      if (dryRun.effects.status.status === 'success') {
        const gasUsed = parseInt(dryRun.effects.gasUsed.computationCost) +
                        parseInt(dryRun.effects.gasUsed.storageCost) -
                        parseInt(dryRun.effects.gasUsed.storageRebate);
        return Math.max(gasUsed * 1.2, 300_000_000);
      }
      return 300_000_000;
    } catch (err) {
      console.warn('Gas estimation error:', err.message);
      return 300_000_000;
    }
  };

  const validateAuctionObject = async (objectId) => {
    try {
      console.log('validateAuctionObject: Fetching object:', objectId);
      const object = await withRetry(() => suiClient.getObject({
        id: objectId,
        options: { showContent: true, showType: true },
      }));
      console.log('validateAuctionObject: Object fetched:', object);
      const expectedType = `${PACKAGE_ID}::marketplace::Auction`;
      if (object.error) {
        console.error('validateAuctionObject: Object fetch error:', object.error);
        throw new Error(`Failed to fetch auction object: ${object.error.message}`);
      }
      if (!object.data) {
        console.error('validateAuctionObject: No data for object:', objectId);
        throw new Error('Auction object not found on blockchain.');
      }
      if (object.data.type !== expectedType) {
        console.error('validateAuctionObject: Invalid type:', object.data.type, 'Expected:', expectedType);
        throw new Error(`Invalid auction type: ${object.data.type}`);
      }
      const fields = object.data.content?.fields;
      if (!fields?.nft_id || !fields?.kiosk_id || typeof fields?.current_bid === 'undefined') {
        console.error('validateAuctionObject: Invalid fields:', fields);
        throw new Error('Invalid auction structure: missing required fields.');
      }
      return object.data;
    } catch (err) {
      console.error('validateAuctionObject: Error:', err.message, err.stack);
      throw new Error(`Unable to verify auction data: ${err.message}`);
    }
  };

  const fetchLiveAuction = async () => {
    setIsLoading(true);
    setError('');
    setSuccess('');
    const timeout = setTimeout(() => {
      setError('Taking too long to load the auction. Please refresh the page.');
      setIsLoading(false);
    }, 15000);
    try {
      console.log('fetchLiveAuction: Querying Firestore for active auction');
      const activeQuery = query(collection(db, 'auctions'), where('status', '==', 'active'));
      let activeSnapshot = await withRetry(() => getDocs(activeQuery));
      let selectedAuction = null;
      if (!activeSnapshot.empty) {
        selectedAuction = activeSnapshot.docs[0].data();
        selectedAuction.id = activeSnapshot.docs[0].id;
        console.log('fetchLiveAuction: Active auction found:', selectedAuction);
      } else {
        console.log('fetchLiveAuction: No active auction found, checking cooldown');
        const completedQuery = query(collection(db, 'auctions'), where('status', '==', 'completed'));
        const completedSnapshot = await withRetry(() => getDocs(completedQuery));
        if (!completedSnapshot.empty) {
          const latestCompleted = completedSnapshot.docs.reduce((latest, doc) => {
            const completedAt = new Date(doc.data().completedAt).getTime();
            return !latest || completedAt > new Date(latest.data().completedAt).getTime() ? doc : latest;
          });
          const completedAt = new Date(latestCompleted.data().completedAt).getTime();
          const cooldownEnd = completedAt + 60 * 60 * 1000;
          if (Date.now() < cooldownEnd) {
            setCooldownUntil(cooldownEnd);
            setError(`Next auction starts soon! Check back at ${new Date(cooldownEnd).toLocaleString('en-US', { hour12: true })}.`);
            setLiveAuction(null);
            setCurrentBid(0);
            setHighestBidderDisplay('None');
            setBidHistory([]);
            console.log('fetchLiveAuction: Cooldown active until', new Date(cooldownEnd));
            return;
          }
        }
      }

      if (!selectedAuction) {
        setError('Next auction starts soon! Check the upcoming auctions below.');
        setLiveAuction(null);
        setCurrentBid(0);
        setHighestBidderDisplay('None');
        setBidHistory([]);
        console.log('fetchLiveAuction: No active or completed auctions, waiting for queued');
        return;
      }

      console.log('fetchLiveAuction: Validating auction data');
      if (
        !selectedAuction.kioskId ||
        selectedAuction.kioskId !== SHARED_KIOSK_ID ||
        !selectedAuction.kioskOwnerCapId ||
        selectedAuction.kioskOwnerCapId !== KIOSK_OWNER_CAP_ID ||
        !selectedAuction.tokenId ||
        !/^0x[a-fA-F0-9]{64}$/.test(selectedAuction.tokenId) ||
        !selectedAuction.collection ||
        !/^0x[a-fA-F0-9]{64}::[a-zA-Z0-9_]+::[a-zA-Z0-9_]+$/.test(selectedAuction.collection) ||
        !selectedAuction.startingBid ||
        typeof selectedAuction.startingBid !== 'number' ||
        selectedAuction.startingBid <= 0 ||
        !selectedAuction.auctionDuration ||
        typeof selectedAuction.auctionDuration !== 'number' ||
        selectedAuction.auctionDuration <= 0 ||
        !selectedAuction.auctionObjectId ||
        !/^(0x)?[a-fA-F0-9]{64}$/.test(selectedAuction.auctionObjectId)
      ) {
        console.error('fetchLiveAuction: Invalid auction data:', selectedAuction);
        throw new Error(`Invalid auction data: ${JSON.stringify(selectedAuction, null, 2)}`);
      }

      const auctionId = selectedAuction.auctionObjectId.startsWith('0x') ? selectedAuction.auctionObjectId : `0x${selectedAuction.auctionObjectId}`;
      console.log('fetchLiveAuction: Validating auction object on blockchain:', auctionId);
      const auctionObject = await validateAuctionObject(auctionId);
      console.log('fetchLiveAuction: Auction object validated:', auctionObject);
      const blockchainCurrentBid = parseInt(auctionObject.content.fields.current_bid || selectedAuction.startingBid) / 1_000_000_000;
      const blockchainHighestBidder = auctionObject.content.fields.highest_bidder === '0x0' ? selectedAuction.seller : auctionObject.content.fields.highest_bidder;

      console.log('fetchLiveAuction: Fetching BidPlaced events');
      const events = await withRetry(() => suiClient.queryEvents({
        query: { MoveEventType: `${PACKAGE_ID}::marketplace::BidPlaced` },
        limit: 100,
        order: 'descending',
      }));
      console.log('fetchLiveAuction: Events fetched:', events.data);

      const bidHistoryData = await Promise.all(
        events.data
          .filter(event => event.parsedJson.auction_id === auctionId)
          .map(async (event) => {
            const fields = event.parsedJson;
            const txBlock = await withRetry(() => suiClient.getTransactionBlock({
              digest: event.id.txDigest,
              options: { showEffects: false, showInput: false, showEvents: false, showObjectChanges: false, showBalanceChanges: false },
            }));
            const timestamp = new Date(parseInt(txBlock.timestampMs)).toLocaleString('en-US', { hour12: true });
            return {
              time: timestamp,
              amount: parseFloat((parseInt(fields.amount) / 1_000_000_000).toFixed(2)),
              bidder: fields.bidder.slice(0, 6) + '...' + fields.bidder.slice(-6),
            };
          })
      );

      // Add the starting bid
      bidHistoryData.push({
        time: new Date(selectedAuction.startedAt || selectedAuction.queuedAt || Date.now()).toLocaleString('en-US', { hour12: true }),
        amount: parseFloat((selectedAuction.startingBid / 1_000_000_000).toFixed(2)),
        bidder: selectedAuction.seller.slice(0, 6) + '...' + selectedAuction.seller.slice(-6),
      });

      // Sort bids by amount in descending order (highest to lowest)
      bidHistoryData.sort((a, b) => b.amount - a.amount);

      console.log('fetchLiveAuction: Validating kiosk object:', selectedAuction.kioskId);
      const kioskObject = await withRetry(() => suiClient.getObject({
        id: selectedAuction.kioskId,
        options: { showContent: true, showType: true, showOwner: true },
      }));
      if (!kioskObject.data || kioskObject.data.type !== '0x2::kiosk::Kiosk' || !kioskObject.data.owner?.Shared) {
        console.error('fetchLiveAuction: Invalid kiosk data:', kioskObject);
        throw new Error('Invalid kiosk data.');
      }

      console.log('fetchLiveAuction: Validating NFT object:', selectedAuction.tokenId);
      const nftObject = await withRetry(() => suiClient.getObject({
        id: selectedAuction.tokenId,
        options: { showContent: true, showType: true },
      }));
      if (nftObject.error || !nftObject.data) {
        console.error('fetchLiveAuction: NFT object error:', nftObject);
        throw new Error('Unable to load NFT details.');
      }

      const contentFields = nftObject.data.content?.fields || {};
      console.log('fetchLiveAuction: NFT contentFields:', contentFields);
      const priceSui = selectedAuction.startingBid / 1_000_000_000;

      console.log('fetchLiveAuction: Setting live auction state');
      setLiveAuction({
        id: selectedAuction.id,
        token_id: selectedAuction.tokenId,
        name: contentFields.name || 'Unknown NFT',
        media_url: contentFields.url || contentFields.image_url || contentFields.media_url || '',
        media_type: contentFields.media_type || 'image',
        ranking: selectedAuction.ranking || null,
        owner: selectedAuction.seller,
        collection: selectedAuction.collection,
        price: selectedAuction.startingBid.toString(),
        price_str: priceSui.toFixed(2),
        seller: selectedAuction.seller,
        startTime: selectedAuction.startedAt || selectedAuction.queuedAt || new Date().toISOString(),
        auctionDuration: selectedAuction.auctionDuration || 2,
        kioskId: selectedAuction.kioskId,
        kioskOwnerCapId: selectedAuction.kioskOwnerCapId,
        auctionObjectId: auctionId,
        highestBidder: blockchainHighestBidder,
      });

      setCurrentBid(blockchainCurrentBid);
      setHighestBidderDisplay(blockchainHighestBidder === selectedAuction.seller ? 'None' : blockchainHighestBidder.slice(0, 6) + '...' + blockchainHighestBidder.slice(-6));
      setBidHistory(bidHistoryData);
      console.log('fetchLiveAuction: Successfully set auction data');
    } catch (err) {
      console.error('fetchLiveAuction: Error:', err.message, err.stack);
      Sentry.captureException(err);
      setError(`Unable to load the auction: ${err.message}`);
      setLiveAuction(null);
      setCurrentBid(0);
      setHighestBidderDisplay('None');
      setBidHistory([]);
    } finally {
      clearTimeout(timeout);
      setIsLoading(false);
    }
  };

  const fetchQueuedAuctions = async () => {
    try {
      console.log('fetchQueuedAuctions: Querying Firestore for queued auctions');
      const queuedQuery = query(collection(db, 'auctions'), where('status', '==', 'queued'));
      const queuedSnapshot = await withRetry(() => getDocs(queuedQuery));
      const queuedList = [];
      for (const doc of queuedSnapshot.docs.slice(0, 5)) {
        const queuedAuction = doc.data();
        queuedAuction.id = doc.id;
        const nftObject = await withRetry(() => suiClient.getObject({
          id: queuedAuction.tokenId,
          options: { showContent: true, showType: true },
        }));
        if (nftObject.error || !nftObject.data) {
          console.warn(`fetchQueuedAuctions: Failed to fetch queued NFT: ${nftObject.error?.message || 'Unknown error'}`);
          continue;
        }
        const contentFields = nftObject.data.content?.fields || {};
        queuedList.push({
          id: queuedAuction.id,
          token_id: queuedAuction.tokenId,
          name: contentFields.name || 'Unknown NFT',
          media_url: contentFields.url || contentFields.image_url || contentFields.media_url || '',
          seller: queuedAuction.seller,
          collection: queuedAuction.collection,
        });
      }
      console.log('fetchQueuedAuctions: Fetched queued auctions:', queuedList);
      setQueuedAuctions(queuedList);
    } catch (err) {
      console.error('fetchQueuedAuctions: Error:', err.message, err.stack);
      Sentry.captureException(err);
      setError('Unable to load upcoming auctions. Please try again later.');
    }
  };

  const fetchCompletedAuctions = async () => {
    try {
      console.log('fetchCompletedAuctions: Querying Firestore for completed auctions');
      const completedQuery = query(collection(db, 'auctions'), where('status', '==', 'completed'));
      const completedSnapshot = await withRetry(() => getDocs(completedQuery), 5, true);
      console.log('fetchCompletedAuctions: Completed auctions snapshot size:', completedSnapshot.size);
      if (completedSnapshot.empty) {
        console.log('fetchCompletedAuctions: No completed auctions found in Firestore.');
        setCompletedAuctions([]);
        setCompletedError('No completed auctions found in the database.');
        return;
      }
      const completedList = [];
      for (const doc of completedSnapshot.docs) {
        const completedAuction = doc.data();
        completedAuction.id = doc.id;
        console.log('fetchCompletedAuctions: Processing completed auction:', {
          id: completedAuction.id,
          tokenId: completedAuction.tokenId,
          seller: completedAuction.seller,
          finalBid: completedAuction.finalBid,
          winner: completedAuction.winner,
          completedAt: completedAuction.completedAt,
          nftTransferred: completedAuction.nftTransferred
        });
        let nftName = 'Unknown NFT';
        try {
          const nftObject = await withRetry(() => suiClient.getObject({
            id: completedAuction.tokenId,
            options: { showContent: true, showType: true },
          }));
          const contentFields = nftObject.data?.content?.fields || {};
          nftName = contentFields.name || 'Unknown NFT';
        } catch (nftErr) {
          console.warn(`fetchCompletedAuctions: Failed to fetch NFT details for tokenId ${completedAuction.tokenId}:`, nftErr.message);
        }
        completedList.push({
          id: completedAuction.id,
          token_id: completedAuction.tokenId,
          name: nftName,
          seller: completedAuction.seller || 'N/A',
          finalBid: (completedAuction.finalBid || 0) / 1_000_000_000,
          winner: completedAuction.winner || 'None',
          completedAt: completedAuction.completedAt || 'N/A',
          nftTransferred: completedAuction.nftTransferred || false,
        });
      }
      console.log('fetchCompletedAuctions: Completed auctions fetched:', completedList);
      setCompletedAuctions(completedList.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()));
      setCompletedError('');
    } catch (err) {
      console.error('fetchCompletedAuctions: Error:', err.message, err.stack);
      Sentry.captureException(err);
      setCompletedError('Unable to load completed auctions. Please try again later.');
      setCompletedAuctions([]);
    }
  };

  const handlePlaceBid = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsBidding(true);
    if (isAuctionEnded) {
      setError('This auction has already ended.');
      setIsBidding(false);
      return;
    }
    if (!wallet.connected) {
      setError('Please connect your wallet to place a bid.');
      setIsBidding(false);
      return;
    }
    const amount = parseFloat(bidAmount);
    if (isNaN(amount)) {
      setError('Please enter a valid bid amount.');
      setIsBidding(false);
      return;
    }
    if (amount <= currentBid + 0.1) {
      setError(`Your bid must be at least ${currentBid.toFixed(2)} SUI + 0.1 SUI.`);
      setIsBidding(false);
      return;
    }
    if (!wallet.account?.address) {
      setError('Unable to find your wallet address.');
      setIsBidding(false);
      return;
    }
    if (!wallet.signAndExecuteTransactionBlock) {
      setError('Your wallet does not support this action.');
      setIsBidding(false);
      return;
    }
    if (!liveAuction?.auctionObjectId || !/^(0x)?[a-fA-F0-9]{64}$/.test(liveAuction.auctionObjectId)) {
      setError('This auction is not available for bidding right now.');
      setIsBidding(false);
      return;
    }

    try {
      const tx = new TransactionBlock();
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(Math.round(amount * 1_000_000_000))]);
      const normalizedAuctionObjectId = liveAuction.auctionObjectId.startsWith('0x') ? liveAuction.auctionObjectId : `0x${liveAuction.auctionObjectId}`;
      tx.moveCall({
        target: `${PACKAGE_ID}::marketplace::place_bid`,
        arguments: [
          tx.object(normalizedAuctionObjectId),
          coin,
          tx.object('0x6'),
        ],
      });

      const gasBudget = await estimateGasBudget(tx);
      const hasEnoughGas = await checkWalletBalance(gasBudget);
      if (!hasEnoughGas) {
        setError('Not enough SUI in your wallet to cover the transaction fee.');
        setIsBidding(false);
        return;
      }

      tx.setGasBudget(gasBudget);

      const result = await wallet.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        requestType: 'WaitForLocalExecution',
        options: { showEffects: true },
        chain: 'sui:mainnet',
      });

      if (result.errors || result.effects?.status.status !== 'success') {
        throw new Error('Transaction could not be completed.');
      }

      const bidData = {
        auctionId: liveAuction.id,
        bidder: wallet.account?.address,
        amount: Math.round(amount * 1_000_000_000),
        timestamp: new Date().toISOString(),
      };
      await withRetry(() => addDoc(collection(db, 'bids'), bidData), 3, true);

      await fetchLiveAuction();
      setSuccess(`Your bid of ${amount.toFixed(2)} SUI was placed successfully!`);
      setBidAmount('');
    } catch (err) {
      console.error('handlePlaceBid: Error:', err.message, err.stack);
      Sentry.captureException(err);
      setError(`Unable to place your bid: ${err.message}`);
    } finally {
      setIsBidding(false);
    }
  };

  const handleAuctionEnd = async () => {
    if (!liveAuction || !wallet.connected || !wallet.signAndExecuteTransactionBlock || wallet.account?.address !== ADMIN_ADDRESS) {
      setError('Only the admin can end the auction. Please check your wallet.');
      return;
    }

    try {
      const auctionId = liveAuction.id;
      const auctionObjectId = liveAuction.auctionObjectId;
      const highestBid = currentBid * 1_000_000_000;
      const highestBidder = liveAuction.highestBidder;
      const seller = liveAuction.seller;

      if (!highestBidder || !/^0x[a-fA-F0-9]{64}$/.test(highestBidder) ||
          !highestBid || isNaN(highestBid) || highestBid <= 0 ||
          !seller || !/^0x[a-fA-F0-9]{64}$/.test(seller) ||
          !auctionObjectId || !/^(0x)?[a-fA-F0-9]{64}$/.test(auctionObjectId)) {
        throw new Error('Invalid auction data.');
      }

      const auctionObject = await validateAuctionObject(auctionObjectId);
      const auctionStatus = parseInt(auctionObject.content.fields.status);
      if (auctionStatus !== 0) {
        try {
          await withRetry(() => updateDoc(doc(db, 'auctions', auctionId), {
            status: 'completed',
            completedAt: new Date().toISOString(),
            finalBid: highestBid,
            winner: highestBidder === '0x0' || highestBidder === seller ? null : highestBidder,
          }), 3, true);
          const bidsQuery = query(collection(db, 'bids'), where('auctionId', '==', auctionId));
          const bidsSnapshot = await withRetry(() => getDocs(bidsQuery));
          for (const bid of bidsSnapshot.docs) {
            await withRetry(() => deleteDoc(doc(db, 'bids', bid.id)), 3, true);
          }
          setSuccess('Auction has already ended. Records updated.');
          fetchLiveAuction();
          fetchCompletedAuctions();
          return;
        } catch (err) {
          console.error('handleAuctionEnd: Firestore update failed:', err.message, err.stack);
          Sentry.captureException(err);
        }
      }

      const normalizedAuctionObjectId = auctionObjectId.startsWith('0x') ? auctionObjectId : `0x${auctionObjectId}`;
      const tx = new TransactionBlock();
      tx.moveCall({
        target: `${PACKAGE_ID}::marketplace::end_auction_no_transfer`,
        arguments: [
          tx.object(normalizedAuctionObjectId),
          tx.object('0x6'),
        ],
      });

      const gasBudget = await estimateGasBudget(tx);
      const hasEnoughGas = await checkWalletBalance(gasBudget);
      if (!hasEnoughGas) {
        setError('Not enough SUI in your wallet to end the auction.');
        return;
      }

      tx.setGasBudget(gasBudget);

      const result = await withRetry(() => wallet.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        requestType: 'WaitForLocalExecution',
        options: { showEffects: true, showObjectChanges: true },
        chain: 'sui:mainnet',
      }));

      if (result.errors || result.effects?.status.status !== 'success') {
        throw new Error('Unable to finalize the auction.');
      }

      try {
        await withRetry(() => updateDoc(doc(db, 'auctions', auctionId), {
          status: 'completed',
          completedAt: new Date().toISOString(),
          finalBid: highestBid,
          winner: highestBidder === '0x0' || highestBidder === seller ? null : highestBidder,
        }), 3, true);
        const bidsQuery = query(collection(db, 'bids'), where('auctionId', '==', auctionId));
        const bidsSnapshot = await withRetry(() => getDocs(bidsQuery));
        for (const bid of bidsSnapshot.docs) {
          await withRetry(() => deleteDoc(doc(db, 'bids', bid.id)), 3, true);
        }
        setSuccess('Auction finalized successfully!');
        fetchLiveAuction();
        fetchCompletedAuctions();
      } catch (err) {
        console.error('handleAuctionEnd: Firestore update failed:', err.message, err.stack);
        Sentry.captureException(err);
        setSuccess('Auction finalized, but records update failed. Auction data is safe.');
      }
    } catch (err) {
      console.error('handleAuctionEnd: Error:', err.message, err.stack);
      Sentry.captureException(err);
      setError(`Unable to end the auction: ${err.message}`);
    }
  };

  useEffect(() => {
    if (!liveAuction || !liveAuction.startTime || !liveAuction.auctionDuration || isNaN(new Date(liveAuction.startTime).getTime()) || liveAuction.auctionDuration <= 0) {
      setTimeLeft('N/A');
      if (liveAuction) {
        fetchLiveAuction();
      }
      return;
    }

    const startTime = new Date(liveAuction.startTime);
    const durationMs = liveAuction.auctionDuration * 60 * 60 * 1000;
    const endTime = startTime.getTime() + durationMs;

    const interval = setInterval(() => {
      const now = Date.now();
      const distance = endTime - now;
      if (distance <= 0) {
        clearInterval(interval);
        setTimeLeft('Auction Ended');
        setIsAuctionEnded(true);
        if (wallet.account?.address === ADMIN_ADDRESS) {
          handleAuctionEnd();
        }
        return;
      }
      const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((distance % (1000 * 60)) / 1000);
      setTimeLeft(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
    }, 1000);

    return () => clearInterval(interval);
  }, [liveAuction, wallet.account?.address]);

  const fixImageUrl = (url) => {
    if (!url || typeof url !== 'string' || url.trim() === '') {
      console.warn('Invalid or empty media_url:', url);
      return '/nft_placeholder.png';
    }
    if (url.startsWith('walrus://')) {
      const transformedUrl = `https://walrus.tusky.io/${url.replace('walrus://', '')}`;
      console.log('Transformed walrus URL:', transformedUrl);
      return transformedUrl;
    }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      const transformedUrl = `https://walrus.tusky.io/${url.replace(/^\/+/, '')}`;
      console.log('Transformed relative URL:', transformedUrl);
      return transformedUrl;
    }
    console.log('Original URL:', url);
    return url;
  };

  const formatCompletedAt = (completedAt) => {
    if (!completedAt) return 'N/A';
    return new Date(completedAt).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
    });
  };

  const collectionAddress = liveAuction?.collection?.split('::')[0] || 'unknown';
  const tradeportUrl = liveAuction?.collection && liveAuction?.token_id && collectionAddress !== 'unknown' && /^0x[a-fA-F0-9]{64}$/.test(collectionAddress)
    ? `https://www.tradeport.xyz/sui/collection/${encodeURIComponent(collectionAddress)}?bottomTab=trades&tab=items&tokenId=${liveAuction.token_id}`
    : null;
  console.log('Generated Tradeport URL:', tradeportUrl);

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress sx={{ color: '#FF007A' }} /></Box>;

  console.log('Rendering Auction Win History with completedAuctions:', completedAuctions);

  return (
    <Box className="live-auction-frame" sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: { xs: 1, md: 1.5 }, maxWidth: 1000, mx: 'auto', p: { xs: 1, md: 1.5 }, bgcolor: 'rgba(255,255,255,0.02)', borderRadius: 2, border: '1px solid #FF4DA6', boxShadow: '0 4px 12px rgba(255,0,122,0.3)' }}>
      <Box sx={{ flex: { xs: 'none', md: 2 }, display: 'flex', flexDirection: 'column', gap: { xs: 1, md: 1.5 } }}>
        {error && <Alert severity="info" sx={{ mb: 2, maxWidth: 600, mx: 'auto', bgcolor: 'rgba(255,0,122,0.1)', color: '#F8FAFC', border: '1px solid #FF4DA6', borderRadius: 1, p: 1, animation: 'fadeIn 0.3s ease-in' }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2, maxWidth: 600, mx: 'auto', bgcolor: 'rgba(0,255,122,0.1)', color: '#F8FAFC', border: '1px solid #00FF7A', borderRadius: 1, p: 1, animation: 'fadeIn 0.3s ease-in' }}>{success}</Alert>}
        {liveAuction && (
          <>
            <Card sx={{ maxWidth: { xs: '100%', sm: 600 }, width: '100%', bgcolor: 'linear-gradient(135deg, #FF007A, #FF4DA6)', p: 1.5, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5, boxShadow: '0 4px 12px rgba(255,0,122,0.5)', borderRadius: 2, '&:hover': { transform: 'scale(1.02)', boxShadow: '0 6px 16px rgba(255,0,122,0.7)' }, transition: 'transform 0.2s ease, box-shadow 0.2s ease' }}>
              <Box sx={{ width: { xs: '100%', sm: '40%' }, mb: { xs: 1, sm: 0 } }}>
                <CardMedia
                  component="img"
                  sx={{ width: '100%', height: { xs: 180, sm: 200 }, objectFit: 'contain', borderRadius: 1.5, border: '2px solid rgba(255,255,255,0.2)' }}
                  image={fixImageUrl(liveAuction.media_url)}
                  alt={liveAuction.name || 'Unknown NFT'}
                  onError={(e) => {
                    console.warn('Image failed to load:', liveAuction.media_url);
                    e.target.src = '/nft_placeholder.png';
                    e.target.alt = 'Image unavailable';
                  }}
                />
{tradeportUrl ? (
  <Box sx={{ mt: 1, textAlign: 'center' }}>
    <Link href={tradeportUrl} target="_blank" rel="noopener noreferrer" aria-label="View on Tradeport">
      <img src="/tradeport-logo.png" alt="Tradeport Logo" style={{ width: 24, height: 24 }} />
    </Link>
  </Box>
) : (
  <Typography variant="body2" sx={{ mt: 1, textAlign: 'center', color: '#FF4DA6' }}>
    Tradeport link unavailable
  </Typography>
)}
<Link
  href={`https://suivision.xyz/object/${liveAuction.token_id}`}
  target="_blank"
  rel="noopener noreferrer"
  sx={{ textDecoration: 'none' }}
  aria-label="View on Suivision"
>
  <Typography
    variant="body2"
    sx={{
      fontSize: '0.9rem',
      textAlign: 'center',
      color: '#F8FAFC',
      opacity: 0.8,
      '&:hover': { color: '#FF4DA6', textDecoration: 'underline' },
    }}
  >
    Token ID: {liveAuction.token_id.slice(0, 6)}...${liveAuction.token_id.slice(-6)}
  </Typography>
</Link>
<Typography
  variant="body2"
  sx={{ fontSize: '0.9rem', textAlign: 'center', color: '#F8FAFC', opacity: 0.8 }}
>
  Ranking: {liveAuction.ranking || 'N/A'} / 10,000
</Typography>
              </Box>
              <CardContent sx={{ width: { xs: '100%', sm: '60%' }, display: 'flex', flexDirection: 'column', gap: 1, p: 1, color: '#F8FAFC' }}>
                <Typography variant="h5" sx={{ fontFamily: '"Poppins", sans-serif', fontWeight: 700, fontSize: { xs: '1.5rem', sm: '1.8rem' }, textAlign: 'center', textShadow: '0 0 6px rgba(255,0,122,0.5)' }}>{liveAuction.name || 'Unknown NFT'}</Typography>
                <Typography variant="body2" sx={{ fontSize: '0.85rem', textAlign: 'center', color: '#F8FAFC', opacity: 0.8 }}>{liveAuction.collection ? `Collection: ${liveAuction.collection.slice(0, 6)}...${liveAuction.collection.slice(-6)}` : 'Sui Blockchain'} | Tradeport-Listed</Typography>
                <Divider sx={{ my: 0.5, bgcolor: 'rgba(255,255,255,0.2)' }} />
                <Typography variant="h4" sx={{ fontFamily: '"Poppins", sans-serif', fontWeight: 700, fontSize: { xs: '1.5rem', md: '2rem' }, textAlign: 'center', color: '#F8FAFC', animation: 'pulse 2s infinite' }}>Time Left: {timeLeft}</Typography>
                <Typography variant="body2" sx={{ fontSize: '0.9rem', textAlign: 'center', color: '#FF4DA6', fontWeight: 600 }}>Top Bid: {currentBid.toFixed(2)} SUI</Typography>
                <Typography variant="body2" sx={{ fontSize: '0.9rem', textAlign: 'center', color: '#F8FAFC', opacity: 0.8 }}>Highest Bidder: {highestBidderDisplay} ({currentBid.toFixed(2)} SUI)</Typography>
                <Typography variant="body2" sx={{ fontSize: '0.9rem', textAlign: 'center', color: '#F8FAFC', opacity: 0.8 }}>Token ID: {liveAuction.token_id.slice(0, 6)}...${liveAuction.token_id.slice(-6)}</Typography>
                <Typography variant="body2" sx={{ fontSize: '0.9rem', textAlign: 'center', color: '#F8FAFC', opacity: 0.8 }}>Ranking: {liveAuction.ranking || 'N/A'} / 10,000</Typography>
                <Typography variant="body2" sx={{ fontSize: '0.9rem', textAlign: 'center', color: '#F8FAFC', opacity: 0.8 }}>Owner: {liveAuction.seller.slice(0, 6)}...${liveAuction.seller.slice(-6)}</Typography>
                <Divider sx={{ my: 0.5, bgcolor: 'rgba(255,255,255,0.2)' }} />
                <form onSubmit={handlePlaceBid}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <TextField type="number" label="Enter bid in SUI" variant="outlined" value={bidAmount} onChange={(e) => setBidAmount(e.target.value)} disabled={!wallet.connected || isAuctionEnded || isBidding} inputProps={{ step: '0.01' }} size="small" sx={{ flex: 1, minWidth: 100, maxWidth: 200, '& .MuiOutlinedInput-root': { bgcolor: 'rgba(255,255,255,0.05)', color: '#F8FAFC', borderColor: '#FF4DA6', '&:hover fieldset': { borderColor: '#A855F7' }, '&.Mui-focused fieldset': { borderColor: '#A855F7' } }, '& .MuiInputLabel-root': { color: '#F8FAFC', fontSize: '0.85rem' } }} />
                    {wallet.connected ? (
                      <Button type="submit" variant="contained" sx={{ bgcolor: '#FF007A', color: '#F8FAFC', fontSize: '0.85rem', px: 1.5, py: 0.5, borderRadius: 1, '&:hover': { bgcolor: '#FF4DA6' }, '&:disabled': { bgcolor: '#6B7280', opacity: 0.7 } }} disabled={!wallet.connected || isAuctionEnded || isBidding}>Place Bid</Button>
                    ) : (
                      <ConnectButton sx={{ bgcolor: '#FF007A', color: '#F8FAFC', fontSize: '0.85rem', px: 1.5, py: 0.5, borderRadius: 1, '&:hover': { bgcolor: '#FF4DA6' } }} label="Connect Wallet" />
                    )}
                  </Box>
                </form>
                {!wallet.connected && <Alert severity="warning" sx={{ mb: 1, fontSize: '0.85rem', textAlign: 'center', bgcolor: 'rgba(255,0,122,0.1)', color: '#F8FAFC', border: '1px solid #FF4DA6', borderRadius: 1, p: 1, animation: 'fadeIn 0.3s ease-in' }}>Please connect your wallet to place a bid.</Alert>}
                {isAuctionEnded && <Alert severity="info" sx={{ mb: 1, fontSize: '0.85rem', textAlign: 'center', bgcolor: 'rgba(255,0,122,0.1)', color: '#F8FAFC', border: '1px solid #FF4DA6', borderRadius: 1, p: 1, animation: 'fadeIn 0.3s ease-in' }}>This auction has ended.</Alert>}
              </CardContent>
            </Card>
            <Card sx={{ maxWidth: { xs: '100%', sm: 600 }, width: '100%', bgcolor: 'rgba(255,255,255,0.03)', p: 1.5, borderRadius: 1.5, border: '1px solid #FF4DA6', boxShadow: '0 2px 8px rgba(255,0,122,0.3)' }}>
              <Typography variant="h6" sx={{ fontFamily: '"Poppins", sans-serif', fontWeight: 600, color: '#FF007A', mb: 1, textAlign: 'center', fontSize: { xs: '1.2rem', md: '1.5rem' } }}>Bid History</Typography>
              {bidHistory.length > 0 ? (
                <Box sx={{ maxHeight: 200, overflowY: 'auto', px: 1 }}>
                  {bidHistory.map((bid, index) => (
                    <Typography key={index} variant="body2" sx={{ fontSize: '0.85rem', color: '#F8FAFC', py: 0.5, borderBottom: '1px solid rgba(255,77,166,0.2)', '&:last-child': { borderBottom: 'none' } }}>{bid.time} - {bid.amount.toFixed(2)} SUI by {bid.bidder}</Typography>
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" sx={{ fontSize: '0.85rem', color: '#B0B3B8', textAlign: 'center' }}>No bids yet</Typography>
              )}
            </Card>
          </>
        )}
        <Card sx={{ maxWidth: { xs: '100%', sm: 600 }, width: '100%', bgcolor: 'rgba(255,255,255,0.03)', p: 1.5, borderRadius: 1.5, border: '3px solid #FF0000', boxShadow: '0 2px 8px rgba(255,0,122,0.3)', display: 'block !important', visibility: 'visible !important' }}>
          <Typography variant="h6" sx={{ fontFamily: '"Poppins", sans-serif', fontWeight: 600, color: '#FF007A', mb: 1, textAlign: 'center', fontSize: { xs: '1.2rem', md: '1.5rem' } }}>Auction Win History</Typography>
          {completedError && (
            <Alert severity="error" sx={{ mb: 1, fontSize: '0.85rem', textAlign: 'center', bgcolor: 'rgba(255,0,122,0.1)', color: '#F8FAFC', border: '1px solid #FF4DA6', borderRadius: 1, p: 1 }}>
              {completedError}
            </Alert>
          )}
          <Box sx={{ maxHeight: 200, overflowY: 'auto', px: 1 }}>
            {completedAuctions.length > 0 ? (
              completedAuctions.slice(0, 5).map((auction, index) => {
                console.log('Rendering auction win entry:', {
                  id: auction.id,
                  name: auction.name,
                  winner: auction.winner,
                  link: auction.winner !== 'None' ? `https://suivision.xyz/account/${auction.winner}` : null
                });
                return (
                  <Typography key={index} variant="body2" sx={{ fontSize: '0.85rem', color: '#F8FAFC', py: 0.5, borderBottom: '1px solid rgba(255,77,166,0.2)', '&:last-child': { borderBottom: 'none' } }}>
                    {formatCompletedAt(auction.completedAt)} - {auction.name} won by{' '}
                    {auction.winner === 'None' ? (
                      'None'
                    ) : (
                      <a
                        href={`https://suivision.xyz/account/${auction.winner}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#00f', textDecoration: 'underline' }}
                      >
                        {auction.winner.slice(0, 6)}...{auction.winner.slice(-6)}
                      </a>
                    )}{' '}
                    for {auction.finalBid.toFixed(2)} SUI
                  </Typography>
                );
              })
            ) : (
              <Typography variant="body2" sx={{ fontSize: '0.85rem', color: '#B0B3B8', textAlign: 'center' }}>
                {completedError || 'No completed auctions'}
              </Typography>
            )}
          </Box>
        </Card>
      </Box>
      {queuedAuctions.length > 0 && (
        <Box sx={{ flex: { xs: 'none', md: 1 }, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography variant="h5" sx={{ fontFamily: '"Poppins", sans-serif', fontWeight: 600, color: '#FF007A', mb: 0.5, textAlign: 'center', fontSize: { xs: '1.5rem', md: '1.8rem' }, textShadow: '0 0 8px rgba(255,0,122,0.5)' }}>Next in Line</Typography>
          {queuedAuctions.map((auction, index) => (
            <QueuedAuctionCard key={auction.id} auction={auction} isPrimary={index === 0} opacity={1 - index * 0.1} />
          ))}
        </Box>
      )}
    </Box>
  );
}

export default LiveAuction;