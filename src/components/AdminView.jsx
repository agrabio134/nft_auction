import React, { useState, useEffect } from 'react';
import { useWallet } from '@suiet/wallet-kit';
import { SuiClient, SuiHTTPTransport, getFullnodeUrl } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, onSnapshot, updateDoc, doc, query, where, getDocs, getDoc } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { Box, Typography, CircularProgress, Button, Snackbar, Alert } from '@mui/material';
import * as Sentry from '@sentry/react';
import '../styles/AdminView.css';

const firebaseConfig = {
  apiKey: "AIzaSyDDcwmxqo2LkCm2a3fXbDvEbi-sPkrYcOQ",
  authDomain: "nft-auction-e169c.firebaseapp.com",
  projectId: "nft-auction-e169c",
  storageBucket: "nft-auction-e169c.firebasestorage.app",
  messagingSenderId: "60237291411",
  appId: "1:60237291411:web:9944186393a20f46779266",
  measurementId: "G-43C6JXQDR2"
};

// Initialize Firebase only if not already initialized
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);
const auth = getAuth(app);

// Initialize Sui Client with a premium RPC endpoint
const MAINNET_URL = getFullnodeUrl('mainnet');
const transport = new SuiHTTPTransport({
  url: MAINNET_URL,
  requestTimeout: 20000,
  maxRetries: 3,
  retryDelay: 5000,
});
const suiClient = new SuiClient({ transport });

// Shared kiosk and admin details
const SHARED_KIOSK_ID = '0x88411ccf93211de8e5f2a6416e4db21de4a0d69fc308a2a72e970ff05758a083';
const KIOSK_OWNER_CAP_ID = '0x5c04a377c1e8c8c54c200db56083cc93eb46243ad4c2cf5b90c4aaef8500cfee';
const ADMIN_ADDRESS = '0x3a74d8e94bf49bb738a3f1dedcc962ed01c89f78d21c01d87ee5e6980f0750e9';
const PACKAGE_ID = '0xe698a87c127715a2a7606fcc7550d96daf082ccb398c95fb1f4d73104aefb6c8';
const FEE_ADDRESS = '0x8cfed3962605beacf459a4bab2830a7c8e95bab8e60c228e65b2837565bd5fb8';
const FEE_PERCENTAGE = 0.075; // 7.5% fee

function AdminView() {
  const wallet = useWallet();
  const [auctions, setAuctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

  // Handle Snackbar close
  const handleCloseSnackbar = (event, reason) => {
    if (reason === 'clickaway') return;
    setSnackbar({ ...snackbar, open: false });
  };

  // Firebase authentication
  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 3;

    const trySignInAnonymously = async () => {
      if (!isAuthenticated) {
        try {
          await signInAnonymously(auth);
          console.log('AdminView: Firebase authentication successful');
        } catch (err) {
          if (retryCount < maxRetries) {
            retryCount++;
            console.warn(`AdminView: Firebase auth retry ${retryCount}/${maxRetries}: ${err.message}`);
            setTimeout(trySignInAnonymously, 2000);
          } else {
            setError('Failed to authenticate with Firebase.');
            Sentry.captureException(err);
            setLoading(false);
          }
        }
      }
    };

    trySignInAnonymously();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
      if (user && wallet.account?.address === ADMIN_ADDRESS) {
        // fetchAuctions is called within real-time listener
      }
    });

    return () => unsubscribe();
  }, [wallet.account?.address]);

  // Utility function for single attempt with retry
  const withRetry = async (operation, maxAttempts = 3) => {
    let attempts = 0;
    while (attempts < maxAttempts) {
      try {
        return await operation();
      } catch (err) {
        attempts++;
        console.error(`Operation failed (attempt ${attempts}/${maxAttempts}): ${err.message}`);
        if (err.message.includes('Deserialization error') || err.message.includes('Request timeout')) {
          throw err;
        }
        if (attempts === maxAttempts) {
          throw err;
        }
        await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
      }
    }
  };

  // Utility function for Firestore updates with retry and verification
  const updateFirestoreWithRetry = async (docRef, data, maxAttempts = 3) => {
    let attempts = 0;
    while (attempts < maxAttempts) {
      try {
        await updateDoc(docRef, data);
        console.log('Firestore update successful:', data);
        // Verify the update
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && docSnap.data().status === data.status) {
          console.log('Firestore update verified:', data.status);
          return true;
        } else {
          throw new Error('Firestore update not reflected in document');
        }
      } catch (err) {
        attempts++;
        console.error(`Firestore update failed (attempt ${attempts}/${maxAttempts}): ${err.message}`);
        if (attempts === maxAttempts) {
          throw new Error(`Failed to update Firestore after ${maxAttempts} attempts: ${err.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
      }
    }
  };

  // Estimate gas budget
  const estimateGasBudget = async (tx) => {
    try {
      const dryRun = await withRetry(() => suiClient.dryRunTransactionBlock({ transactionBlock: tx }));
      if (dryRun.effects.status.status === 'success') {
        const gasUsed = parseInt(dryRun.effects.gasUsed.computationCost) +
          parseInt(dryRun.effects.gasUsed.storageCost) -
          parseInt(dryRun.effects.gasUsed.storageRebate);
        return Math.max(gasUsed * 1.5, 100_000_000);
      }
      console.warn('Dry run failed, using fallback gas budget');
      return 150_000_000;
    } catch (err) {
      console.error('Gas estimation error:', err.message);
      Sentry.captureException(err);
      return 150_000_000;
    }
  };

  // Fetch auctions with real-time updates and queue management
  useEffect(() => {
    if (!isAuthenticated || wallet.account?.address !== ADMIN_ADDRESS) return;

    setLoading(true);
    const unsubscribeFirestore = onSnapshot(collection(db, 'auctions'), async (querySnapshot) => {
      try {
        console.log('fetchAuctions: Firestore snapshot received, size:', querySnapshot.size);
        const auctionList = [];
        const kioskItems = await withRetry(() => suiClient.getDynamicFields({ parentId: SHARED_KIOSK_ID }));
        const kioskItemIds = kioskItems.data.map(item => item.objectId);

        for (const doc of querySnapshot.docs) {
          const data = doc.data();
          const auction = {
            id: doc.id,
            tokenId: data.tokenId || 'N/A',
            seller: data.seller || 'N/A',
            startingBid: data.startingBid || 0,
            auctionDuration: data.auctionDuration || 0,
            status: data.status || 'unknown',
            transferredTo: data.transferredTo || null,
            nftObjectId: data.nftObjectId || null,
            collection: data.collection || 'unknown',
            startedAt: data.startedAt || null,
            auctionObjectId: data.auctionObjectId || null,
            currentBid: data.startingBid || 0,
            highestBidder: data.seller || 'N/A',
            completedAt: data.completedAt || null,
            winner: data.winner || 'N/A',
            nftTransferred: data.nftTransferred || !kioskItemIds.includes(data.nftObjectId),
            createdAt: data.createdAt || null,
            finalBid: data.finalBid || 0,
            kioskId: data.kioskId || null,
            kioskOwnerCapId: data.kioskOwnerCapId || null,
            isPriority: data.isPriority || false,
            receiptId: data.receiptId || 'N/A',
          };

          if (auction.status === 'active' && auction.auctionObjectId) {
            try {
              const auctionObject = await withRetry(() =>
                suiClient.getObject({
                  id: auction.auctionObjectId,
                  options: { showContent: true, showType: true },
                })
              );
              if (!auctionObject.error && auctionObject.data?.type.includes('::marketplace::Auction')) {
                const fields = auctionObject.data.content?.fields || {};
                auction.currentBid = parseInt(fields.current_bid || auction.startingBid) / 1_000_000_000;
                auction.highestBidder = fields.highest_bidder === '0x0' ? auction.seller : fields.highest_bidder;
              }
            } catch (err) {
              console.warn(`Failed to fetch Auction object ${auction.auctionObjectId}: ${err.message}`);
            }
          }
          auctionList.push(auction);
        }
        console.log('fetchAuctions: Auction list:', auctionList);
        setAuctions(auctionList);
        if (auctionList.length === 0) {
          setError('No auctions found.');
        } else {
          const activeAuctions = auctionList.filter(a => a.status === 'active');
          const queuedAuctions = auctionList.filter(a => a.status === 'queued').sort((a, b) => {
            // Prioritize isPriority auctions, then sort by createdAt
            if (a.isPriority && !b.isPriority) return -1;
            if (!a.isPriority && b.isPriority) return 1;
            const aTime = new Date(a.createdAt || 0).getTime();
            const bTime = new Date(b.createdAt || 0).getTime();
            return aTime - bTime;
          });

          if (activeAuctions.length === 0 && queuedAuctions.length > 0) {
            const completedQuery = query(collection(db, 'auctions'), where('status', '==', 'completed'));
            const completedSnapshot = await getDocs(completedQuery);
            let canActivate = true;
            if (!completedSnapshot.empty) {
              const latestCompleted = completedSnapshot.docs.reduce((latest, doc) => {
                const completedAt = new Date(doc.data().completedAt).getTime();
                return !latest || completedAt > new Date(latest.data().completedAt).getTime() ? doc : latest;
              });
              const completedAt = new Date(latestCompleted.data().completedAt).getTime();
              const cooldownEnd = completedAt + 60 * 60 * 1000;
              if (Date.now() < cooldownEnd) {
                canActivate = false;
                setError(`No active auctions. Next auction starts after cooldown at ${new Date(cooldownEnd).toLocaleString('en-US', { hour12: true })}`);
              }
            }
            if (canActivate) {
              console.log('fetchAuctions: Auto-activating first queued auction:', queuedAuctions[0]);
              await activateQueuedAuction(queuedAuctions[0]);
            }
          }
        }
      } catch (err) {
        console.error('Error processing auctions:', err);
        Sentry.captureException(err);
        setError(`Failed to load auctions: ${err.message}`);
      } finally {
        setLoading(false);
      }
    }, (err) => {
      console.error('Firestore snapshot error:', err);
      Sentry.captureException(err);
      setError('Failed to subscribe to auctions.');
      setLoading(false);
    });

    let subscriptionActive = true;
    const subscribeToEvents = async () => {
      let retryCount = 0;
      const maxRetries = 3;
      while (subscriptionActive && retryCount < maxRetries) {
        try {
          const unsubscribeEvents = await suiClient.subscribeEvent({
            filter: {
              MoveEventType: `${PACKAGE_ID}::marketplace::BidPlaced`,
            },
            onMessage: async (event) => {
              const fields = event.parsedJson;
              const auctionId = fields.auction_id;
              console.log('Received BidPlaced event:', fields);
              const auction = auctions.find(a => a.auctionObjectId === auctionId);
              if (auction && auction.status === 'active') {
                try {
                  const auctionObject = await withRetry(() =>
                    suiClient.getObject({
                      id: auctionId,
                      options: { showContent: true, showType: true },
                    })
                  );
                  if (!auctionObject.error && auctionObject.data?.type.includes('::marketplace::Auction')) {
                    const fields = auctionObject.data.content?.fields || {};
                    setAuctions(prev => prev.map(a =>
                      a.auctionObjectId === auctionId
                        ? { ...a, currentBid: parseInt(fields.current_bid) / 1_000_000_000, highestBidder: fields.highest_bidder === '0x0' ? a.seller : fields.highest_bidder }
                        : a
                    ));
                  }
                } catch (err) {
                  console.warn(`Failed to update bid for auction ${auctionId}: ${err.message}`);
                }
              }
            },
          });
          return unsubscribeEvents;
        } catch (err) {
          retryCount++;
          console.warn(`Event subscription failed (attempt ${retryCount}/${maxRetries}: ${err.message}`);
          if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 5000 * retryCount));
          } else {
            Sentry.captureException(err);
            setError('Failed to subscribe to bid events.');
          }
        }
      }
    };

    const unsubscribeEvents = subscribeToEvents();

    return () => {
      subscriptionActive = false;
      unsubscribeFirestore();
      unsubscribeEvents.then(unsub => unsub && unsub()).catch(err => console.error('Error unsubscribing events:', err));
    };
  }, [isAuthenticated, wallet.account?.address]);

  // Function to activate a queued auction
  const activateQueuedAuction = async (auction) => {
    if (!wallet.connected || !wallet.signAndExecuteTransactionBlock) {
      setError('Please connect a compatible wallet.');
      return;
    }
    if (!isAuthenticated) {
      setError('Please wait for Firebase authentication.');
      return;
    }
    if (wallet.account?.address !== ADMIN_ADDRESS) {
      setError('Only the admin wallet can activate auctions.');
      return;
    }
    try {
      const nftObjectId = auction.nftObjectId;
      const kioskId = auction.kioskId;
      const kioskOwnerCapId = auction.kioskOwnerCapId;
      if (!nftObjectId || !kioskId || !kioskOwnerCapId) {
        setError('Missing NFT object ID, kiosk ID, or KioskOwnerCap ID.');
        return;
      }
      if (!/^0x[a-fA-F0-9]{64}$/.test(nftObjectId)) {
        throw new Error(`Invalid NFT object ID format: ${nftObjectId}`);
      }
      if (kioskId !== SHARED_KIOSK_ID || kioskOwnerCapId !== KIOSK_OWNER_CAP_ID) {
        setError(`Auction must use the shared kiosk (${SHARED_KIOSK_ID}) and KioskOwnerCap (${KIOSK_OWNER_CAP_ID}).`);
        return;
      }

      const capObject = await withRetry(() =>
        suiClient.getObject({
          id: kioskOwnerCapId,
          options: { showContent: true, showOwner: true },
        })
      );
      if (!capObject.data || capObject.data.content?.fields?.for !== kioskId || capObject.data.owner?.AddressOwner !== ADMIN_ADDRESS) {
        throw new Error(`Invalid KioskOwnerCap ${kioskOwnerCapId} or not owned by admin.`);
      }

      const kioskObject = await withRetry(() =>
        suiClient.getObject({
          id: kioskId,
          options: { showContent: true, showType: true, showOwner: true },
        })
      );
      if (!kioskObject.data || kioskObject.data.type !== '0x2::kiosk::Kiosk' || !kioskObject.data.owner?.Shared) {
        throw new Error(`Kiosk ${kioskId} is invalid or not shared.`);
      }

      const kioskItems = await withRetry(() => suiClient.getDynamicFields({ parentId: kioskId }));
      const nftInKiosk = kioskItems.data.some(item => item.objectId === nftObjectId);
      if (!nftInKiosk) {
        throw new Error(`NFT ${nftObjectId} is not in the kiosk ${kioskId}. Verify with: sui client object --id ${nftObjectId}`);
      }

      const tx = new TransactionBlock();
      tx.moveCall({
        target: `${PACKAGE_ID}::marketplace::list_nft`,
        arguments: [
          tx.object(kioskId),
          tx.object(kioskOwnerCapId),
          tx.pure.id(nftObjectId),
          tx.pure.u64(auction.startingBid),
          tx.pure.u64(auction.auctionDuration * 60 * 60 * 1000),
          tx.object('0x6'),
        ],
        typeArguments: [auction.collection],
      });

      const gasBudget = await estimateGasBudget(tx);
      tx.setGasBudget(gasBudget);

      console.log('activateQueuedAuction: Executing transaction to list NFT', { nftObjectId, kioskId });
      const result = await wallet.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        requestType: 'WaitForLocalExecution',
        options: { showEffects: true, showObjectChanges: true },
        chain: 'sui:mainnet',
      });

      if (result.errors || result.effects?.status.status !== 'success') {
        throw new Error(`Failed to list NFT: ${JSON.stringify(result.errors || 'Transaction failed')}`);
      }

      const auctionObject = result.objectChanges?.find(
        change => change.type === 'created' && change.objectType.includes('::marketplace::Auction')
      );
      if (!auctionObject) {
        throw new Error('Failed to find created Auction object in transaction result.');
      }
      const auctionObjectId = auctionObject.objectId;
      console.log('activateQueuedAuction: Setting auctionObjectId to:', auctionObjectId);

      await updateFirestoreWithRetry(doc(db, 'auctions', auction.id), {
        status: 'active',
        startedAt: new Date().toISOString(),
        auctionObjectId: auctionObjectId,
      });

      setSnackbar({
        open: true,
        message: `Auction for NFT ${nftObjectId.slice(0, 6)}...${nftObjectId.slice(-6)} activated successfully!`,
        severity: 'success',
      });
    } catch (err) {
      console.error('Error activating queued auction:', err);
      Sentry.captureException(err);
      setError(`Failed to activate auction: ${err.message}. Verify NFT ID: ${auction.nftObjectId}`);
    }
  };

  const handleApprove = async (auction, retry = true) => {
    if (!wallet.connected || !wallet.signAndExecuteTransactionBlock) {
      setError('Please connect a compatible wallet.');
      return;
    }
    if (!isAuthenticated) {
      setError('Please wait for Firebase authentication.');
      return;
    }
    if (wallet.account?.address !== ADMIN_ADDRESS) {
      setError('Only the admin wallet can approve auctions.');
      return;
    }
    try {
      const nftObjectId = auction.nftObjectId;
      const seller = auction.seller;
      if (!nftObjectId || !seller) {
        setError('Missing NFT object ID or seller address.');
        return;
      }
      if (!/^0x[a-fA-F0-9]{64}$/.test(nftObjectId)) {
        throw new Error(`Invalid NFT object ID format: ${nftObjectId}`);
      }

      // Verify NFT is owned by admin address
      const nftObject = await withRetry(() =>
        suiClient.getObject({
          id: nftObjectId,
          options: { showContent: true, showType: true, showOwner: true },
        })
      );
      if (!nftObject.data) {
        throw new Error(`NFT ${nftObjectId} not found. Verify ID with: sui client object --id ${nftObjectId}`);
      }
      if (nftObject.data.owner?.AddressOwner !== ADMIN_ADDRESS) {
        throw new Error(`NFT ${nftObjectId} is not owned by admin address ${ADMIN_ADDRESS}. Current owner: ${JSON.stringify(nftObject.data.owner)}`);
      }

      // Verify shared kiosk and KioskOwnerCap
      const capObject = await withRetry(() =>
        suiClient.getObject({
          id: KIOSK_OWNER_CAP_ID,
          options: { showContent: true, showOwner: true },
        })
      );
      if (!capObject.data || capObject.data.content?.fields?.for !== SHARED_KIOSK_ID || capObject.data.owner?.AddressOwner !== ADMIN_ADDRESS) {
        throw new Error(`Invalid KioskOwnerCap ${KIOSK_OWNER_CAP_ID} or not owned by admin.`);
      }

      const kioskObject = await withRetry(() =>
        suiClient.getObject({
          id: SHARED_KIOSK_ID,
          options: { showContent: true, showType: true, showOwner: true },
        })
      );
      if (!kioskObject.data || kioskObject.data.type !== '0x2::kiosk::Kiosk' || !kioskObject.data.owner?.Shared) {
        throw new Error(`Kiosk ${SHARED_KIOSK_ID} is invalid or not shared. Verify with: sui client object --id ${SHARED_KIOSK_ID}`);
      }

      // Place NFT in shared kiosk
      const tx = new TransactionBlock();
      tx.moveCall({
        target: `${PACKAGE_ID}::marketplace::place_nft`,
        arguments: [
          tx.object(SHARED_KIOSK_ID),
          tx.object(KIOSK_OWNER_CAP_ID),
          tx.object(nftObjectId),
        ],
        typeArguments: [auction.collection],
      });

      const gasBudget = await estimateGasBudget(tx);
      tx.setGasBudget(gasBudget);

      console.log('handleApprove: Executing transaction to place NFT', { nftObjectId, kioskId: SHARED_KIOSK_ID });
      const result = await wallet.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        requestType: 'WaitForLocalExecution',
        options: { showEffects: true, showObjectChanges: true },
        chain: 'sui:mainnet',
      });

      if (result.errors || result.effects?.status.status !== 'success') {
        if (retry) {
          console.warn('handleApprove: Retrying place after 5000ms');
          await new Promise(resolve => setTimeout(resolve, 5000));
          return await handleApprove(auction, false);
        }
        throw new Error(`Failed to place NFT: ${JSON.stringify(result.errors || 'Transaction failed')}`);
      }

      // Update Firestore with kiosk details
      await updateFirestoreWithRetry(doc(db, 'auctions', auction.id), {
        status: 'queued',
        updatedAt: new Date().toISOString(),
        kioskId: SHARED_KIOSK_ID,
        kioskOwnerCapId: KIOSK_OWNER_CAP_ID,
      });

      setSnackbar({
        open: true,
        message: `NFT ${nftObjectId.slice(0, 6)}...${nftObjectId.slice(-6)} placed in shared kiosk and queued for auction!`,
        severity: 'success',
      });
    } catch (err) {
      console.error('Error approving auction:', err);
      Sentry.captureException(err);
      setError(`Failed to approve auction: ${err.message}. Verify NFT ID: ${auction.nftObjectId}`);
    }
  };

  const handleReject = async (auction, retry = true) => {
    if (!wallet.connected || !wallet.signAndExecuteTransactionBlock) {
      setError('Please connect a compatible wallet.');
      return;
    }
    if (!isAuthenticated) {
      setError('Please wait for Firebase authentication.');
      return;
    }
    if (wallet.account?.address !== ADMIN_ADDRESS) {
      setError('Only the admin wallet can reject auctions.');
      return;
    }
    try {
      const nftObjectId = auction.nftObjectId;
      const seller = auction.seller;
      if (!nftObjectId || !seller) {
        setError('Missing NFT object ID or seller address.');
        return;
      }
      if (!/^0x[a-fA-F0-9]{64}$/.test(nftObjectId)) {
        throw new Error(`Invalid NFT object ID format: ${nftObjectId}`);
      }

      // Verify NFT is owned by admin address
      const nftObject = await withRetry(() =>
        suiClient.getObject({
          id: nftObjectId,
          options: { showContent: true, showType: true, showOwner: true },
        })
      );
      if (!nftObject.data) {
        throw new Error(`NFT ${nftObjectId} not found. Verify ID with: sui client object --id ${nftObjectId}`);
      }
      if (nftObject.data.owner?.AddressOwner !== ADMIN_ADDRESS) {
        throw new Error(`NFT ${nftObjectId} is not owned by admin address ${ADMIN_ADDRESS}. Current owner: ${JSON.stringify(nftObject.data.owner)}`);
      }

      // Transfer NFT back to seller
      const tx = new TransactionBlock();
      tx.moveCall({
        target: '0x2::transfer::public_transfer',
        arguments: [
          tx.object(nftObjectId),
          tx.pure(seller),
        ],
        typeArguments: [auction.collection],
      });

      const gasBudget = await estimateGasBudget(tx);
      tx.setGasBudget(gasBudget);

      console.log('handleReject: Executing transaction to return NFT to seller', { nftObjectId, seller });
      const result = await wallet.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        requestType: 'WaitForLocalExecution',
        options: { showEffects: true, showObjectChanges: true },
        chain: 'sui:mainnet',
      });

      if (result.errors || result.effects?.status.status !== 'success') {
        if (retry) {
          console.warn('handleReject: Retrying transfer after 5000ms');
          await new Promise(resolve => setTimeout(resolve, 5000));
          return await handleReject(auction, false);
        }
        throw new Error(`Failed to return NFT to seller: ${JSON.stringify(result.errors || 'Transaction failed')}`);
      }

      // Update Firestore
      await updateFirestoreWithRetry(doc(db, 'auctions', auction.id), {
        status: 'rejected',
        updatedAt: new Date().toISOString(),
        nftTransferred: true,
        nftTransferredAt: new Date().toISOString(),
      });

      setSnackbar({
        open: true,
        message: `NFT ${nftObjectId.slice(0, 6)}...${nftObjectId.slice(-6)} rejected and returned to seller ${seller.slice(0, 6)}...${seller.slice(-6)}.`,
        severity: 'info',
      });
    } catch (err) {
      console.error('Error rejecting auction:', err);
      Sentry.captureException(err);
      setError(`Failed to reject auction: ${err.message}. Verify NFT ID: ${auction.nftObjectId}`);
    }
  };

  const handleDelist = async (auction, retry = true) => {
    if (!wallet.connected || !wallet.signAndExecuteTransactionBlock) {
      setError('Please connect a compatible wallet.');
      return;
    }
    if (!isAuthenticated) {
      setError('Please wait for Firebase authentication.');
      return;
    }
    if (wallet.account?.address !== ADMIN_ADDRESS) {
      setError('Only the admin wallet can delist auctions.');
      return;
    }
    try {
      const nftObjectId = auction.nftObjectId;
      const kioskId = auction.kioskId;
      const kioskOwnerCapId = auction.kioskOwnerCapId;
      const auctionObjectId = auction.auctionObjectId;
      const auctionId = auction.id;
      const isQueued = auction.status === 'queued';
      if (!nftObjectId || !kioskId || !kioskOwnerCapId) {
        setError('Missing NFT object ID, kiosk ID, or KioskOwnerCap ID.');
        return;
      }
      if (!/^0x[a-fA-F0-9]{64}$/.test(nftObjectId)) {
        throw new Error(`Invalid NFT object ID format: ${nftObjectId}`);
      }
      if (kioskId !== SHARED_KIOSK_ID || kioskOwnerCapId !== KIOSK_OWNER_CAP_ID) {
        setError(`Auction must use the shared kiosk (${SHARED_KIOSK_ID}) and KioskOwnerCap (${KIOSK_OWNER_CAP_ID}).`);
        return;
      }
      if (!isQueued && !auctionObjectId) {
        setError('Missing Auction object ID for non-queued auction.');
        return;
      }

      const capObject = await withRetry(() =>
        suiClient.getObject({
          id: kioskOwnerCapId,
          options: { showContent: true, showOwner: true },
        })
      );
      if (!capObject.data || capObject.data.content?.fields?.for !== kioskId || capObject.data.owner?.AddressOwner !== ADMIN_ADDRESS) {
        throw new Error(`Invalid KioskOwnerCap ${kioskOwnerCapId} or not owned by admin.`);
      }

      const kioskObject = await withRetry(() =>
        suiClient.getObject({
          id: kioskId,
          options: { showContent: true, showType: true, showOwner: true },
        })
      );
      if (!kioskObject.data || kioskObject.data.type !== '0x2::kiosk::Kiosk' || !kioskObject.data.owner?.Shared) {
        throw new Error(`Kiosk ${kioskId} is invalid or not shared.`);
      }

      const kioskItems = await withRetry(() => suiClient.getDynamicFields({ parentId: kioskId }));
      const nftInKiosk = kioskItems.data.some(item => item.objectId === nftObjectId);
      if (!nftInKiosk) {
        await updateFirestoreWithRetry(doc(db, 'auctions', auction.id), {
          status: 'canceled',
          updatedAt: new Date().toISOString(),
          nftTransferred: true,
          nftTransferredAt: new Date().toISOString(),
        });
        setSnackbar({
          open: true,
          message: `NFT ${nftObjectId.slice(0, 6)}...${nftObjectId.slice(-6)} not in kiosk, marked as canceled.`,
          severity: 'info',
        });
        return;
      }

      let tx = new TransactionBlock();
      if (!isQueued) {
        console.log('handleDelist: Executing delist transaction', { nftObjectId, kioskId });
        tx.moveCall({
          target: '0x2::kiosk::delist',
          arguments: [
            tx.object(kioskId),
            tx.object(kioskOwnerCapId),
            tx.pure.id(nftObjectId),
          ],
          typeArguments: [auction.collection],
        });

        let gasBudget = await estimateGasBudget(tx);
        tx.setGasBudget(gasBudget);

        const delistResult = await wallet.signAndExecuteTransactionBlock({
          transactionBlock: tx,
          requestType: 'WaitForLocalExecution',
          options: { showEffects: true },
          chain: 'sui:mainnet',
        });

        if (delistResult.errors || delistResult.effects?.status.status !== 'success') {
          console.warn('AdminView: Delist failed, proceeding to withdraw');
        } else {
          console.log('AdminView: Successfully delisted NFT');
        }

        tx = new TransactionBlock();
      }

      const nft = tx.moveCall({
        target: '0x2::kiosk::take',
        arguments: [
          tx.object(kioskId),
          tx.object(kioskOwnerCapId),
          tx.pure.id(nftObjectId),
        ],
        typeArguments: [auction.collection],
      });
      tx.transferObjects([nft], auction.seller);

      const gasBudget = await estimateGasBudget(tx);
      tx.setGasBudget(gasBudget);

      console.log('handleDelist: Executing withdraw transaction', { nftObjectId, kioskId });
      const withdrawResult = await wallet.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        requestType: 'WaitForLocalExecution',
        options: { showEffects: true, showObjectChanges: true },
        chain: 'sui:mainnet',
      });

      if (withdrawResult.errors || withdrawResult.effects?.status.status !== 'success') {
        if (retry) {
          console.warn('AdminView: Retrying delist/withdraw after 5000ms');
          await new Promise(resolve => setTimeout(resolve, 5000));
          return await handleDelist(auction, false);
        }
        throw new Error(`Failed to withdraw NFT: ${JSON.stringify(withdrawResult.errors || 'Transaction failed')}`);
      }

      if (!isQueued && auctionObjectId) {
        tx = new TransactionBlock();
        tx.moveCall({
          target: '0x2::object::delete',
          arguments: [tx.object(auctionObjectId)],
        });

        const gasBudget = await estimateGasBudget(tx);
        tx.setGasBudget(gasBudget);

        console.log('handleDelist: Deleting Auction object', { auctionObjectId });
        const deleteResult = await wallet.signAndExecuteTransactionBlock({
          transactionBlock: tx,
          requestType: 'WaitForLocalExecution',
          options: { showEffects: true },
          chain: 'sui:mainnet',
        });

        if (deleteResult.errors || deleteResult.effects?.status.status !== 'success') {
          console.warn('AdminView: Failed to delete Auction object, continuing');
        }
      }

      await updateFirestoreWithRetry(doc(db, 'auctions', auction.id), {
        status: 'canceled',
        updatedAt: new Date().toISOString(),
        nftTransferred: true,
        nftTransferredAt: new Date().toISOString(),
      });

      setSnackbar({
        open: true,
        message: `Auction for NFT ${nftObjectId.slice(0, 6)}...${nftObjectId.slice(-6)} delisted and withdrawn successfully!`,
        severity: 'success',
      });
    } catch (err) {
      console.error('Error delisting/withdrawing:', err);
      Sentry.captureException(err);
      setError(`Failed to delist/withdraw: ${err.message}. Verify NFT ID: ${auction.nftObjectId}`);
    }
  };

  const handleReleaseFunds = async (auction, retry = true) => {
    if (!wallet.connected || !wallet.signAndExecuteTransactionBlock) {
      setError('Please connect a compatible wallet.');
      return;
    }
    if (!isAuthenticated) {
      setError('Please wait for Firebase authentication.');
      return;
    }
    if (wallet.account?.address !== ADMIN_ADDRESS) {
      setError('Only the admin wallet can release funds.');
      return;
    }
    try {
      const auctionObjectId = auction.auctionObjectId;
      const kioskId = auction.kioskId;
      const kioskOwnerCapId = auction.kioskOwnerCapId;
      const nftObjectId = auction.nftObjectId;
      if (!auctionObjectId || !kioskId || !kioskOwnerCapId || !nftObjectId) {
        setError('Missing Auction object ID, kiosk ID, KioskOwnerCap ID, or NFT object ID.');
        return;
      }
      if (!/^0x[a-fA-F0-9]{64}$/.test(nftObjectId)) {
        throw new Error(`Invalid NFT object ID format: ${nftObjectId}`);
      }

      const auctionObject = await withRetry(() =>
        suiClient.getObject({
          id: auctionObjectId,
          options: { showContent: true, showType: true, showOwner: true },
        })
      );
      if (!auctionObject.data) {
        throw new Error(`Auction object not found: ${auctionObjectId}`);
      }
      if (!auctionObject.data.type.includes('::marketplace::Auction')) {
        throw new Error(`Invalid Auction object type: ${auctionObject.data.type}`);
      }

      const capObject = await withRetry(() =>
        suiClient.getObject({
          id: kioskOwnerCapId,
          options: { showContent: true, showOwner: true },
        })
      );
      if (!capObject.data || capObject.data.content?.fields?.for !== kioskId || capObject.data.owner?.AddressOwner !== ADMIN_ADDRESS) {
        throw new Error(`Invalid KioskOwnerCap ${kioskOwnerCapId} or not owned by admin.`);
      }

      const kioskObject = await withRetry(() =>
        suiClient.getObject({
          id: kioskId,
          options: { showContent: true, showType: true, showOwner: true },
        })
      );
      if (!kioskObject.data || kioskObject.data.type !== '0x2::kiosk::Kiosk' || !kioskObject.data.owner?.Shared) {
        throw new Error(`Kiosk ${kioskId} is invalid or not shared.`);
      }

      const kioskItems = await withRetry(() => suiClient.getDynamicFields({ parentId: kioskId }));
      const nftInKiosk = kioskItems.data.some(item => item.objectId === nftObjectId);
      if (!nftInKiosk) {
        throw new Error(`NFT ${nftObjectId} is not in the kiosk ${kioskId}. Verify with: sui client object --id ${nftObjectId}`);
      }

      if (parseInt(auctionObject.data.content?.fields?.end_time || 0) > Date.now()) {
        console.log('Attempting to end auction before recovering funds', { auctionObjectId });
        const endTx = new TransactionBlock();
        endTx.moveCall({
          target: `${PACKAGE_ID}::marketplace::end_auction_no_transfer`,
          arguments: [
            endTx.object(auctionObjectId),
            endTx.object('0x6'),
          ],
        });
        const endResult = await wallet.signAndExecuteTransactionBlock({
          transactionBlock: endTx,
          requestType: 'WaitForLocalExecution',
          options: { showEffects: true, showObjectChanges: true },
          chain: 'sui:mainnet',
        });
        if (endResult.errors || endResult.effects?.status.status !== 'success') {
          throw new Error(`Failed to end auction: ${JSON.stringify(endResult.errors || 'Transaction failed')}`);
        }
        console.log('Auction ended successfully');
      }

      const tx = new TransactionBlock();
      tx.moveCall({
        target: `${PACKAGE_ID}::marketplace::end_auction_no_transfer`,
        arguments: [
          tx.object(auctionObjectId),
          tx.object('0x6'),
        ],
      });

      const gasBudget = await estimateGasBudget(tx);
      tx.setGasBudget(gasBudget);

      console.log('handleReleaseFunds: Executing end_auction_no_transfer transaction', { auctionObjectId });
      const result = await wallet.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        requestType: 'WaitForLocalExecution',
        options: { showEffects: true, showObjectChanges: true },
        chain: 'sui:mainnet',
      });

      if (result.errors || result.effects?.status.status !== 'success') {
        if (retry) {
          console.warn('AdminView: Retrying end_auction_no_transfer after 5000ms');
          await new Promise(resolve => setTimeout(resolve, 5000));
          return await handleReleaseFunds(auction, false);
        }
        throw new Error(`Failed to end auction: ${JSON.stringify(result.errors || 'Transaction failed')}`);
      }

      const balance = parseInt(auctionObject.data.content?.fields?.balance || 0) / 1_000_000_000;
      const feeAmount = balance * FEE_PERCENTAGE;
      const sellerAmount = balance - feeAmount;

      await updateFirestoreWithRetry(doc(db, 'auctions', auction.id), {
        status: 'completed',
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        winner: auctionObject.data.content?.fields?.highest_bidder === '0x0' ? auction.seller : auctionObject.data.content?.fields?.highest_bidder,
        finalBid: balance * 1_000_000_000,
        feeAmount: feeAmount * 1_000_000_000,
        sellerAmount: sellerAmount * 1_000_000_000,
      });

      setSnackbar({
        open: true,
        message: `Funds recovered successfully! ${balance.toFixed(3)} SUI distributed: ${feeAmount.toFixed(3)} SUI to fee address, ${sellerAmount.toFixed(3)} SUI to seller ${auction.seller.slice(0, 6)}...${auction.seller.slice(-6)}.`,
        severity: 'success',
      });

      const queuedQuery = query(collection(db, 'auctions'), where('status', '==', 'queued'));
      const queuedSnapshot = await getDocs(queuedQuery);
      if (!queuedSnapshot.empty) {
        const queuedAuctions = queuedSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => {
          if (a.isPriority && !b.isPriority) return -1;
          if (!a.isPriority && b.isPriority) return 1;
          const aTime = new Date(a.createdAt || 0).getTime();
          const bTime = new Date(b.createdAt || 0).getTime();
          return aTime - bTime;
        });
        console.log('handleReleaseFunds: Activating next queued auction:', queuedAuctions[0]);
        await activateQueuedAuction(queuedAuctions[0]);
      }
    } catch (err) {
      console.error('Error recovering funds:', err);
      Sentry.captureException(err);
      if (err.message.includes('Request timeout: suix_subscribeEvent') && retry) {
        console.warn('AdminView: Retrying due to subscription timeout after 5000ms');
        await new Promise(resolve => setTimeout(resolve, 5000));
        return await handleReleaseFunds(auction, false);
      }
      setError(`Failed to recover funds: ${err.message}. Verify NFT ID: ${auction.nftObjectId}`);
    }
  };

  const handleReleaseNFT = async (auction, retry = true) => {
    if (!wallet.connected || !wallet.signAndExecuteTransactionBlock) {
      setError('Please connect a compatible wallet.');
      return;
    }
    if (!isAuthenticated) {
      setError('Please wait for Firebase authentication.');
      return;
    }
    if (wallet.account?.address !== ADMIN_ADDRESS) {
      setError('Only the admin wallet can release NFTs.');
      return;
    }
    try {
      const nftObjectId = auction.nftObjectId;
      const kioskId = auction.kioskId;
      const kioskOwnerCapId = auction.kioskOwnerCapId;
      const winner = auction.winner;
      const auctionId = auction.id;
      if (!nftObjectId || !kioskId || !kioskOwnerCapId || !winner || winner === 'N/A' || winner === auction.seller) {
        setError('Missing NFT object ID, kiosk ID, KioskOwnerCap ID, or valid winner address.');
        return;
      }
      if (!/^0x[a-fA-F0-9]{64}$/.test(nftObjectId)) {
        throw new Error(`Invalid NFT object ID format: ${nftObjectId}`);
      }
      if (kioskId !== SHARED_KIOSK_ID || kioskOwnerCapId !== KIOSK_OWNER_CAP_ID) {
        setError(`NFT release must use the shared kiosk (${SHARED_KIOSK_ID}) and KioskOwnerCap (${KIOSK_OWNER_CAP_ID}).`);
        return;
      }
      if (auction.status !== 'completed') {
        setError('NFT can only be released for completed auctions.');
        return;
      }

      const capObject = await withRetry(() =>
        suiClient.getObject({
          id: kioskOwnerCapId,
          options: { showContent: true, showOwner: true },
        })
      );
      if (!capObject.data || capObject.data.content?.fields?.for !== kioskId || capObject.data.owner?.AddressOwner !== ADMIN_ADDRESS) {
        throw new Error(`Invalid KioskOwnerCap ${kioskOwnerCapId} or not owned by admin.`);
      }

      const kioskObject = await withRetry(() =>
        suiClient.getObject({
          id: kioskId,
          options: { showContent: true, showType: true, showOwner: true },
        })
      );
      if (!kioskObject.data || kioskObject.data.type !== '0x2::kiosk::Kiosk' || !kioskObject.data.owner?.Shared) {
        throw new Error(`Kiosk ${kioskId} is invalid or not shared.`);
      }

      const kioskItems = await withRetry(() => suiClient.getDynamicFields({ parentId: kioskId }));
      const nftInKiosk = kioskItems.data.some(item => item.objectId === nftObjectId);
      if (!nftInKiosk) {
        await updateFirestoreWithRetry(doc(db, 'auctions', auction.id), {
          nftTransferred: true,
          nftTransferredAt: new Date().toISOString(),
        });
        console.log('handleReleaseNFT: NFT not in kiosk, marked as transferred in Firestore', { nftObjectId, auctionId });
        setSnackbar({
          open: true,
          message: `NFT ${nftObjectId.slice(0, 6)}...${nftObjectId.slice(-6)} is not in the kiosk and has been marked as transferred.`,
          severity: 'info',
        });
        return;
      }

      const nftObject = await withRetry(() =>
        suiClient.getObject({
          id: nftObjectId,
          options: { showContent: true, showType: true, showOwner: true },
        })
      );
      if (!nftObject.data) {
        throw new Error(`NFT ${nftObjectId} not found. Verify ID with: sui client object --id ${nftObjectId}`);
      }

      const listingObjectId = nftObject.data.owner?.ObjectOwner || null;
      let tx = new TransactionBlock();
      if (listingObjectId) {
        console.log('handleReleaseNFT: Delisting NFT', { nftObjectId, kioskId });
        tx.moveCall({
          target: '0x2::kiosk::delist',
          arguments: [
            tx.object(kioskId),
            tx.object(kioskOwnerCapId),
            tx.pure.id(nftObjectId),
          ],
          typeArguments: [auction.collection],
        });
      }

      const nft = tx.moveCall({
        target: '0x2::kiosk::take',
        arguments: [
          tx.object(kioskId),
          tx.object(kioskOwnerCapId),
          tx.pure.id(nftObjectId),
        ],
        typeArguments: [auction.collection],
      });
      tx.transferObjects([nft], winner);

      const gasBudget = await estimateGasBudget(tx);
      tx.setGasBudget(gasBudget);

      console.log('handleReleaseNFT: Executing transaction to delist (if needed), withdraw, and transfer NFT', { nftObjectId, kioskId, winner });
      const result = await wallet.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        requestType: 'WaitForLocalExecution',
        options: { showEffects: true, showObjectChanges: true },
        chain: 'sui:mainnet',
      });

      if (result.errors || result.effects?.status.status !== 'success') {
        if (retry) {
          console.warn('AdminView: Retrying NFT release after 5000ms');
          await new Promise(resolve => setTimeout(resolve, 5000));
          return await handleReleaseNFT(auction, false);
        }
        throw new Error(`Failed to release NFT: ${JSON.stringify(result.errors || 'Transaction failed')}`);
      }

      await updateFirestoreWithRetry(doc(db, 'auctions', auction.id), {
        nftTransferred: true,
        nftTransferredAt: new Date().toISOString(),
      });

      console.log('handleReleaseNFT: NFT released successfully to', winner);
      setSnackbar({
        open: true,
        message: `NFT ${nftObjectId.slice(0, 6)}...${nftObjectId.slice(-6)} successfully transferred to winner ${winner.slice(0, 6)}...${winner.slice(-6)}!`,
        severity: 'success',
      });
    } catch (err) {
      console.error('Error releasing NFT:', err);
      Sentry.captureException(err);
      setError(`Failed to release NFT: ${err.message}. Verify NFT ID: ${auction.nftObjectId}`);
    }
  };

  const getTimeLeft = (startTime, duration) => {
    if (!startTime || !duration) return 'N/A';
    const start = new Date(startTime).getTime();
    const durationMs = duration * 60 * 60 * 1000;
    const end = start + durationMs;
    const now = Date.now();
    if (now >= end) return 'Auction Ended';
    const distance = end - now;
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
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

  return (
    <Box className="admin-view-container">
      <Typography variant="h5" sx={{ fontFamily: '"Poppins", "Roboto", sans-serif', fontWeight: 700, mb: 2, textAlign: 'center', color: '#fff' }}>
        Admin Auction Approvals
      </Typography>
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
          <CircularProgress />
        </Box>
      )}
      {error && (
        <Typography className="error">{error}</Typography>
      )}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Alert
          onClose={handleCloseSnackbar}
          severity={snackbar.severity}
          sx={{
            width: '100%',
            fontFamily: '"Poppins", "Roboto", sans-serif',
            backgroundColor: snackbar.severity === 'success' ? '#4caf50' : snackbar.severity === 'error' ? '#f44336' : '#2196f3',
            color: '#fff',
            '.MuiAlert-icon': { color: '#fff' },
          }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
      {!loading && auctions.filter(a => a.status === 'active').length > 0 && (
        <Box sx={{ mb: 3 }} className="active-auction">
          <Typography variant="h6" sx={{ fontFamily: '"Poppins", "Roboto", sans-serif', fontWeight: 600, mb: 1, color: '#fff' }}>
            Active Auction
          </Typography>
          <table className="auctions-table">
            <thead>
              <tr>
                <th>Receipt ID</th>
                <th>Token ID</th>
                <th>Seller</th>
                <th>Starting Bid (SUI)</th>
                <th>Current Bid (SUI)</th>
                <th>Highest Bidder</th>
                <th>Time Left</th>
                <th>Priority</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {auctions.filter(a => a.status === 'active').map((auction) => (
                <tr key={auction.id}>
                  <td>{auction.receiptId}</td>
                  <td>{auction.tokenId.slice(0, 6)}...{auction.tokenId.slice(-6)}</td>
                  <td>
                    <a
                      href={`https://suivision.xyz/account/${auction.seller}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#00f', textDecoration: 'underline' }}
                    >
                      {auction.seller.slice(0, 6)}...{auction.seller.slice(-6)}
                    </a>
                  </td>
                  <td>{(auction.startingBid / 1_000_000_000).toFixed(2)}</td>
                  <td>{(auction.currentBid / 1_000_000_000).toFixed(2)}</td>
                  <td>
                    <a
                      href={`https://suivision.xyz/account/${auction.highestBidder}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#00f', textDecoration: 'underline' }}
                    >
                      {auction.highestBidder.slice(0, 6)}...{auction.highestBidder.slice(-6)}
                    </a>
                  </td>
                  <td>{getTimeLeft(auction.startedAt, auction.auctionDuration)}</td>
                  <td>{auction.isPriority ? 'Yes' : 'No'}</td>
                  <td>
                    <button className="delist-button" onClick={() => handleDelist(auction)}>Delist</button>
                    <button className="release-button" onClick={() => handleReleaseFunds(auction)}>Release Funds</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}
      {!loading && auctions.filter(a => a.status === 'queued').length > 0 && (
        <Box sx={{ mb: 3 }} className="queued-auctions">
          <Typography variant="h6" sx={{ fontFamily: '"Poppins", "Roboto", sans-serif', fontWeight: 600, mb: 1, color: '#fff' }}>
            Queued Auctions
          </Typography>
          <table className="auctions-table">
            <thead>
              <tr>
                <th>Receipt ID</th>
                <th>Token ID</th>
                <th>Seller</th>
                <th>Starting Bid (SUI)</th>
                <th>Duration (Hours)</th>
                <th>Priority</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {auctions.filter(a => a.status === 'queued').map((auction) => (
                <tr key={auction.id}>
                  <td>{auction.receiptId}</td>
                  <td>{auction.tokenId.slice(0, 6)}...{auction.tokenId.slice(-6)}</td>
                  <td>
                    <a
                      href={`https://suivision.xyz/account/${auction.seller}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#00f', textDecoration: 'underline' }}
                    >
                      {auction.seller.slice(0, 6)}...{auction.seller.slice(-6)}
                    </a>
                  </td>
                  <td>{(auction.startingBid / 1_000_000_000).toFixed(2)}</td>
                  <td>{auction.auctionDuration}</td>
                  <td>{auction.isPriority ? 'Yes' : 'No'}</td>
                  <td>
                    <button className="delist-button" onClick={() => handleDelist(auction)}>Delist</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}
      {!loading && auctions.filter(a => a.status === 'queued').length === 0 && (
        <Box sx={{ mb: 3 }} className="queued-auctions">
          <Typography variant="h6" sx={{ fontFamily: '"Poppins", "Roboto", sans-serif', fontWeight: 600, mb: 1, color: '#fff' }}>
            Queued Auctions
          </Typography>
          <Typography sx={{ fontSize: '0.9rem', color: '#fff', textAlign: 'center' }}>
            No queued auctions.
          </Typography>
        </Box>
      )}
      {!loading && auctions.filter(a => a.status === 'completed').length > 0 && (
        <Box sx={{ mb: 3 }} className="completed-auctions">
          <Typography variant="h6" sx={{ fontFamily: '"Poppins", "Roboto", sans-serif', fontWeight: 600, mb: 1, color: '#fff' }}>
            Auction Ended History
          </Typography>
          <table className="auctions-table">
            <thead>
              <tr>
                <th>Receipt ID</th>
                <th>Token ID</th>
                <th>Seller</th>
                <th>Final Bid (SUI)</th>
                <th>Winner</th>
                <th>End Time</th>
                <th>NFT Transferred</th>
                <th>Priority</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {auctions.filter(a => a.status === 'completed').map((auction) => (
                <tr key={auction.id}>
                  <td>{auction.receiptId}</td>
                  <td>{auction.tokenId.slice(0, 6)}...{auction.tokenId.slice(-6)}</td>
                  <td>
                    <a
                      href={`https://suivision.xyz/account/${auction.seller}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#00f', textDecoration: 'underline' }}
                    >
                      {auction.seller.slice(0, 6)}...{auction.seller.slice(-6)}
                    </a>
                  </td>
                  <td>{(auction.finalBid / 1_000_000_000).toFixed(2) || 'N/A'}</td>
                  <td>
                    <a
                      href={`https://suivision.xyz/account/${auction.winner}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#00f', textDecoration: 'underline' }}
                    >
                      {auction.winner.slice(0, 6)}...{auction.winner.slice(-6)}
                    </a>
                  </td>
                  <td>{formatCompletedAt(auction.completedAt)}</td>
                  <td>{auction.nftTransferred ? 'Yes' : 'No'}</td>
                  <td>{auction.isPriority ? 'Yes' : 'No'}</td>
                  <td>
                    {!auction.nftTransferred && auction.winner !== 'N/A' && auction.winner !== auction.seller && (
                      <button className="release-nft-button" onClick={() => handleReleaseNFT(auction)}>Release NFT</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}
      {!loading && auctions.filter(a => a.status === 'completed').length === 0 && (
        <Box sx={{ mb: 3 }} className="completed-auctions">
          <Typography variant="h6" sx={{ fontFamily: '"Poppins", "Roboto", sans-serif', fontWeight: 600, mb: 1, color: '#fff' }}>
            Auction Ended History
          </Typography>
          <Typography sx={{ fontSize: '0.9rem', color: '#fff', textAlign: 'center' }}>
            No completed auctions.
          </Typography>
        </Box>
      )}
      {!loading && (
        <Box sx={{ mb: 3 }} className="pending-canceled-rejected">
          <Typography variant="h6" sx={{ fontFamily: '"Poppins", "Roboto", sans-serif', fontWeight: 600, mb: 1, color: '#fff' }}>
            Pending/Cancel Requested/Rejected
          </Typography>
          {auctions.filter(a => ['pending', 'cancel_requested', 'rejected'].includes(a.status)).length === 0 ? (
            <Typography sx={{ fontSize: '0.9rem', color: '#fff', textAlign: 'center' }}>
              No pending, cancel requested, or rejected auctions.
            </Typography>
          ) : (
            <table className="auctions-table">
              <thead>
                <tr>
                  <th>Receipt ID</th>
                  <th>Token ID</th>
                  <th>Seller</th>
                  <th>Starting Bid (SUI)</th>
                  <th>Duration (Hours)</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {auctions.filter(a => ['pending', 'cancel_requested', 'rejected'].includes(a.status)).map((auction) => (
                  <tr key={auction.id}>
                    <td>{auction.receiptId}</td>
                    <td>{auction.tokenId.slice(0, 6)}...{auction.tokenId.slice(-6)}</td>
                    <td>
                      <a
                        href={`https://suivision.xyz/account/${auction.seller}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: '#00f', textDecoration: 'underline' }}
                      >
                        {auction.seller.slice(0, 6)}...{auction.seller.slice(-6)}
                      </a>
                    </td>
                    <td>{(auction.startingBid / 1_000_000_000).toFixed(2)}</td>
                    <td>{auction.auctionDuration}</td>
                    <td>{auction.isPriority ? 'Yes' : 'No'}</td>
                    <td>{auction.status}</td>
                    <td>
                      {(auction.status === 'pending' || auction.status === 'cancel_requested') && (
                        <>
                          <button className="approve-button" onClick={() => handleApprove(auction)}>Approve</button>
                          <button className="reject-button" onClick={() => handleReject(auction)}>
                            {auction.status === 'cancel_requested' ? 'Approve Cancellation' : 'Reject'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Box>
      )}
    </Box>
  );
}

export default AdminView;