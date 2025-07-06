import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useWallet } from '@suiet/wallet-kit';
import { useLocation, useNavigate } from 'react-router-dom';
import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { initializeApp } from 'firebase/app';
import { getFirestore, addDoc, collection } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { Box, Typography, TextField, Select, MenuItem, Button, Alert, Link } from '@mui/material';
import * as Sentry from '@sentry/react';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDDcwmxqo2LkCm2a3fXbDvEbi-sPkrYcOQ",
  authDomain: "nft-auction-e169c.firebaseapp.com",
  projectId: "nft-auction-e169c",
  storageBucket: "nft-auction-e169c.firebasestorage.app",
  messagingSenderId: "60237291411",
  appId: "1:60237291411:web:9944186393a20f46779266",
  measurementId: "G-43C6JXQDR2"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Initialize Sui Client for mainnet
const MAINNET_URL = getFullnodeUrl('mainnet');
const suiClient = new SuiClient({ url: MAINNET_URL });

// Cache version for invalidation
const CACHE_VERSION = 'v19';

// Shared kiosk and admin details
const SHARED_KIOSK_ID = '0x88411ccf93211de8e5f2a6416e4db21de4a0d69fc308a2a72e970ff05758a083';
const KIOSK_OWNER_CAP_ID = '0x5c04a377c1e8c8c54c200db56083cc93eb46243ad4c2cf5b90c4aaef8500cfee';
const ADMIN_ADDRESS = '0x3a74d8e94bf49bb738a3f1dedcc962ed01c89f78d21c01d87ee5e6980f0750e9';

// Error Boundary Component
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ maxWidth: 550, mx: 'auto', mt: 2 }}>
          <Typography variant="h6" color="error" sx={{ mb: 1, textAlign: 'center', fontFamily: '"Poppins", "Roboto", sans-serif' }}>
            Something went wrong
          </Typography>
          <Typography variant="body2" color="error" sx={{ textAlign: 'center', fontSize: '0.8rem' }}>
            {this.state.error?.message || 'Unknown error'}
          </Typography>
        </Box>
      );
    }
    return this.props.children;
  }
}

function ApplyForm() {
  const wallet = useWallet();
  const location = useLocation();
  const navigate = useNavigate();
  const { tokenId: prefilledTokenId } = location.state || {};
  const [formData, setFormData] = useState({
    tokenId: prefilledTokenId || '',
    startingBid: '',
    auctionDuration: '2',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const hasCheckedTokenId = useRef(false);

  // Memoize prefilledTokenId
  const memoizedTokenId = useMemo(() => prefilledTokenId, [prefilledTokenId]);

  // Validate prefilledTokenId
  useEffect(() => {
    if (hasCheckedTokenId.current) return;
    hasCheckedTokenId.current = true;
    console.log('ApplyForm: prefilledTokenId:', memoizedTokenId);
    if (!memoizedTokenId) {
      setError('No Token ID provided. Please select an NFT.');
      setTimeout(() => navigate('/'), 2000);
    } else if (!/^0x[a-fA-F0-9]{64}$/.test(memoizedTokenId)) {
      setError('Invalid Token ID format.');
      setTimeout(() => navigate('/'), 2000);
    }
  }, [memoizedTokenId, navigate]);

  // Firebase authentication
  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 3;

    const trySignInAnonymously = async () => {
      if (wallet.connected && !isAuthenticated) {
        try {
          await signInAnonymously(auth);
        } catch (err) {
          if (retryCount < maxRetries) {
            retryCount++;
            setTimeout(trySignInAnonymously, 1000);
          } else {
            setError('Failed to authenticate with Firebase.');
            Sentry.captureException(err);
          }
        }
      }
    };

    trySignInAnonymously();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
    });

    return () => unsubscribe();
  }, [wallet.connected]);

  // Handle wallet errors
  useEffect(() => {
    if (wallet.error) {
      setError('Failed to connect wallet. Try Sui Wallet (https://chrome.google.com/webstore/detail/sui-wallet/opcgpfmipidbgpenhmajoajpbobppdil).');
      Sentry.captureException(wallet.error);
    }
  }, [wallet.error]);

  // Estimate gas budget
  const estimateGasBudget = async (tx) => {
    try {
      const dryRun = await suiClient.dryRunTransactionBlock({ transactionBlock: tx });
      if (dryRun.effects.status.status === 'success') {
        const gasUsed = parseInt(dryRun.effects.gasUsed.computationCost) +
                        parseInt(dryRun.effects.gasUsed.storageCost) -
                        parseInt(dryRun.effects.gasUsed.storageRebate);
        return Math.max(gasUsed * 2, 200_000_000); // 0.2 SUI minimum
      }
      return 2_000_000_000; // 2 SUI fallback
    } catch {
      return 2_000_000_000; // 2 SUI fallback
    }
  };

  const checkSuiBalance = async () => {
    try {
      const balance = await suiClient.getBalance({
        owner: wallet.account?.address,
        coinType: '0x2::sui::SUI',
      });
      const totalBalance = parseInt(balance.totalBalance) / 1_000_000_000;
      console.log('ApplyForm: SUI balance:', totalBalance);
      return totalBalance >= 0.2;
    } catch (err) {
      setError(`Failed to check SUI balance: ${err.message}`);
      Sentry.captureException(err);
      return false;
    }
  };

  const fetchObjectId = async (tokenId, retry = false) => {
    if (!tokenId) {
      setError('No Token ID provided.');
      return null;
    }
    try {
      if (!/^0x[a-fA-F0-9]{64}$/.test(tokenId)) {
        throw new Error('Invalid Token ID format.');
      }
      const cacheKey = `nft_${tokenId}_${CACHE_VERSION}`;
      localStorage.removeItem(cacheKey);
      console.log('ApplyForm: Cleared NFT cache for tokenId:', tokenId);

      let nftObject;
      try {
        nftObject = await suiClient.getObject({
          id: tokenId,
          options: { showType: true, showOwner: true, showContent: true },
        });
      } catch (err) {
        if (retry) {
          console.warn(`ApplyForm: Retrying NFT fetch for ${tokenId}`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          return await fetchObjectId(tokenId, false);
        }
        throw new Error(`Failed to fetch NFT: ${err.message}. Check: sui client object --id ${tokenId}`);
      }

      if (nftObject.error || !nftObject.data) {
        throw new Error(`Failed to fetch NFT: ${nftObject.error?.message || 'Unknown error'}. Check: sui client object --id ${tokenId}`);
      }
      console.log('ApplyForm: Sui NFT object:', nftObject.data);

      const ownerInfo = nftObject.data?.owner;
      let isInKiosk = false;
      let kioskId = null;

      if (ownerInfo?.AddressOwner && ownerInfo.AddressOwner === wallet.account?.address) {
        console.log('ApplyForm: NFT is directly owned by wallet:', wallet.account?.address);
      } else if (ownerInfo?.ObjectOwner) {
        isInKiosk = true;
        kioskId = ownerInfo.ObjectOwner;
        console.log('ApplyForm: NFT is in kiosk:', kioskId);
      } else {
        throw new Error(`NFT with tokenId ${tokenId} is not owned by your wallet. Verify: sui client object --id ${tokenId}`);
      }

      const nftType = nftObject.data?.type || 'unknown';
      const contentFields = nftObject.data.content?.fields || {};

      const nftData = {
        objectId: nftObject.data.objectId,
        nftCollection: nftType,
        name: contentFields.name || 'Unknown NFT',
        isInKiosk,
        kioskId,
      };
      localStorage.setItem(cacheKey, JSON.stringify(nftData));
      return nftData;
    } catch (err) {
      setError(err.message);
      Sentry.captureException(err);
      return null;
    }
  };

  const validateKiosk = async (kioskId, retry = false) => {
    try {
      const kioskObject = await suiClient.getObject({
        id: kioskId,
        options: { showContent: true, showType: true, showOwner: true },
      });
      if (kioskObject.error || !kioskObject.data || kioskObject.data.type !== '0x2::kiosk::Kiosk' || !kioskObject.data.owner?.Shared) {
        throw new Error(`Kiosk ${kioskId} is invalid or not shared.`);
      }
      const kioskFields = kioskObject.data.content?.fields;
      if (!kioskFields?.item_count && kioskFields.item_count !== 0) {
        throw new Error(`Kiosk ${kioskId} missing item_count field.`);
      }
      console.log(`ApplyForm: Validated kiosk ${kioskId} with item_count: ${kioskFields.item_count}`);
      return { isValid: true, kioskObject };
    } catch (err) {
      if (retry) {
        console.warn(`ApplyForm: Retrying kiosk validation for ${kioskId}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        return await validateKiosk(kioskId, false);
      }
      console.warn(`ApplyForm: Failed to validate kiosk ${kioskId}: ${err.message}`);
      return { isValid: false, error: err.message };
    }
  };

  const checkKioskStatus = async (nftObjectId, kioskId) => {
    if (!kioskId) return null;
    const validation = await validateKiosk(kioskId, true);
    if (!validation.isValid) {
      console.warn(`ApplyForm: Kiosk ${kioskId} is invalid: ${validation.error}`);
      return null;
    }
    try {
      const kioskFields = validation.kioskObject.data.content?.fields;
      const items = await suiClient.getDynamicFields({
        parentId: kioskFields.items?.fields?.id?.id || kioskId,
      });
      const isListed = items.data?.some(item => item.objectId === nftObjectId);
      const isLocked = kioskFields?.items?.fields?.contents?.some(
        content => content.fields?.id === nftObjectId && content.fields?.is_locked
      );
      if (isListed || isLocked) {
        return {
          isInKiosk: true,
          isListed,
          isLocked,
          message: `NFT is ${isListed ? 'listed' : 'locked'} in kiosk ${kioskId}. Withdraw it via TradePort (https://www.tradeport.xyz).`,
        };
      }
      return { isInKiosk: true };
    } catch (err) {
      console.error('ApplyForm: Error checking kiosk status:', err.message);
      Sentry.captureException(err);
      return null;
    }
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
    setSuccess('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!wallet.connected || !wallet.signAndExecuteTransactionBlock) {
      setError('Please connect a compatible wallet (e.g., Sui Wallet).');
      return;
    }
    if (!isAuthenticated) {
      setError('Please wait for authentication.');
      return;
    }
    if (!formData.tokenId || !formData.startingBid) {
      setError('Token ID and Starting Bid are required.');
      return;
    }
    const startingBid = parseFloat(formData.startingBid);
    if (isNaN(startingBid) || startingBid <= 0) {
      setError('Starting bid must be a positive number.');
      return;
    }
    if (isSubmitting) {
      setError('Submission in progress, please wait...');
      return;
    }

    setIsSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const hasSufficientBalance = await checkSuiBalance();
      if (!hasSufficientBalance) {
        throw new Error('Insufficient SUI balance for gas fees (min 0.2 SUI).');
      }

      console.log('ApplyForm: Fetching NFT details for tokenId:', formData.tokenId);
      const nftData = await fetchObjectId(formData.tokenId, true);
      if (!nftData) {
        throw new Error(`Invalid Token ID ${formData.tokenId}. Check: sui client objects --address ${wallet.account?.address || 'your-address'}`);
      }
      let { objectId: nftObjectId, nftCollection, name, isInKiosk, kioskId: sourceKioskId } = nftData;

      // Verify kiosk status
      const kioskStatus = await checkKioskStatus(nftObjectId, sourceKioskId);
      if (kioskStatus?.message) {
        throw new Error(kioskStatus.message);
      }
      isInKiosk = kioskStatus?.isInKiosk || false;
      if (!isInKiosk) {
        sourceKioskId = null;
      }

      // Validate shared kiosk
      const validation = await validateKiosk(SHARED_KIOSK_ID, true);
      if (!validation.isValid) {
        throw new Error(`Shared kiosk ${SHARED_KIOSK_ID} is invalid: ${validation.error}.`);
      }

      // If NFT is in another kiosk, withdraw it
      if (isInKiosk && sourceKioskId) {
        const kioskOwnerCaps = await suiClient.getOwnedObjects({
          owner: wallet.account?.address || '',
          filter: { StructType: '0x2::kiosk::KioskOwnerCap' },
          options: { showContent: true },
        });
        const matchingCap = kioskOwnerCaps.data.find(
          cap => cap.data?.content?.fields?.for === sourceKioskId
        );

        if (matchingCap) {
          const sourceKioskOwnerCapId = matchingCap.data?.objectId;
          const tx = new TransactionBlock();
          const nft = tx.moveCall({
            target: `0x2::kiosk::take`,
            arguments: [
              tx.object(sourceKioskId),
              tx.object(sourceKioskOwnerCapId),
              tx.pure.id(nftObjectId),
            ],
            typeArguments: [nftCollection],
          });
          tx.transferObjects([nft], wallet.account?.address);

          const gasBudget = await estimateGasBudget(tx);
          tx.setGasBudget(gasBudget);
          const takeResult = await wallet.signAndExecuteTransactionBlock({
            transactionBlock: tx,
            requestType: 'WaitForLocalExecution',
            options: { showObjectChanges: true, showEffects: true },
            chain: 'sui:mainnet',
          });
          if (takeResult.errors) {
            throw new Error(`Failed to withdraw NFT from kiosk ${sourceKioskId}: ${JSON.stringify(takeResult.errors)}. Withdraw via TradePort (https://www.tradeport.xyz).`);
          }
          console.log('ApplyForm: Withdrew NFT from kiosk, proceeding as directly owned');
          isInKiosk = false;
        } else {
          throw new Error(`You do not own the KioskOwnerCap for kiosk ${sourceKioskId}. Withdraw via TradePort (https://www.tradeport.xyz).`);
        }
      }

      // Place NFT in shared kiosk
      if (!isInKiosk || sourceKioskId !== SHARED_KIOSK_ID) {
        let placeTx = new TransactionBlock();
        placeTx.moveCall({
          target: `0x2::kiosk::place`,
          arguments: [
            placeTx.object(SHARED_KIOSK_ID),
            placeTx.object(KIOSK_OWNER_CAP_ID),
            placeTx.object(nftObjectId),
          ],
          typeArguments: [nftCollection],
        });
        const gasBudget = await estimateGasBudget(placeTx);
        placeTx.setGasBudget(gasBudget);
        const placeResult = await wallet.signAndExecuteTransactionBlock({
          transactionBlock: placeTx,
          requestType: 'WaitForLocalExecution',
          options: { showObjectChanges: true, showEffects: true },
          chain: 'sui:mainnet',
        });
        if (placeResult.errors) {
          throw new Error(`Failed to place NFT in shared kiosk: ${JSON.stringify(placeResult.errors)}.`);
        }
      }

      // Submit to Firestore
      const applicationData = {
        tokenId: formData.tokenId,
        startingBid: startingBid * 1_000_000_000,
        auctionDuration: parseInt(formData.auctionDuration),
        seller: wallet.account?.address || '',
        status: 'pending',
        submittedAt: new Date().toISOString(),
        nftObjectId,
        collection: nftCollection,
        name,
        kioskId: SHARED_KIOSK_ID,
        kioskOwnerCapId: KIOSK_OWNER_CAP_ID,
      };
      try {
        await addDoc(collection(db, 'auctions'), applicationData);
        setSuccess('NFT submitted for auction approval!');
      } catch (firestoreErr) {
        setError(`Failed to save auction data: ${firestoreErr.message}.`);
        Sentry.captureException(firestoreErr);
      }
      setFormData({ tokenId: '', startingBid: '', auctionDuration: '2' });
    } catch (err) {
      setError(`Failed to submit application: ${err.message}. If the issue persists, withdraw on TradePort (https://www.tradeport.xyz).`);
      Sentry.captureException(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ErrorBoundary>
      <Box
        sx={{
          maxWidth: 550,
          mx: 'auto',
          mt: 2,
          p: { xs: 1, sm: 2 },
          bgcolor: 'background.default',
        }}
      >
        <Typography
          variant="h5"
          sx={{
            fontFamily: '"Poppins", "Roboto", sans-serif',
            fontWeight: 700,
            color: 'text.primary',
            textAlign: 'center',
            mb: 2,
            fontSize: { xs: '1.2rem', sm: '1.5rem' },
          }}
        >
          Apply to List NFT for Auction
        </Typography>
        <Box
          component="form"
          onSubmit={handleSubmit}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
          }}
        >
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', mb: 0.5, fontSize: '0.8rem' }}>
              Token ID (Object ID)
            </Typography>
            <TextField
              fullWidth
              variant="outlined"
              name="tokenId"
              value={formData.tokenId}
              onChange={handleChange}
              placeholder="Enter Token ID (e.g., 0x7796fc76f9753be1a214dd5a2b8b4fe2a0a34f142b99aa01333de9264d7746dd)"
              disabled={!wallet.connected || !!memoizedTokenId}
              size="small"
              sx={{
                '& .MuiOutlinedInput-root': {
                  fontSize: '0.8rem',
                  bgcolor: 'background.paper',
                  borderRadius: 1,
                },
              }}
            />
          </Box>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', mb: 0.5, fontSize: '0.8rem' }}>
              Starting Bid (SUI)
            </Typography>
            <TextField
              fullWidth
              variant="outlined"
              type="number"
              name="startingBid"
              value={formData.startingBid}
              onChange={handleChange}
              placeholder="Enter starting bid in SUI"
              inputProps={{ step: '0.01' }}
              disabled={!wallet.connected}
              size="small"
              sx={{
                '& .MuiOutlinedInput-root': {
                  fontSize: '0.8rem',
                  bgcolor: 'background.paper',
                  borderRadius: 1,
                },
              }}
            />
          </Box>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', mb: 0.5, fontSize: '0.8rem' }}>
              Auction Duration (Hours)
            </Typography>
            <Select
              fullWidth
              variant="outlined"
              name="auctionDuration"
              value={formData.auctionDuration}
              onChange={handleChange}
              disabled={!wallet.connected}
              size="small"
              sx={{
                fontSize: '0.8rem',
                bgcolor: 'background.paper',
                borderRadius: 1,
              }}
            >
              <MenuItem value="2">2 Hours</MenuItem>
              <MenuItem value="4">4 Hours</MenuItem>
              <MenuItem value="8">8 Hours</MenuItem>
              <MenuItem value="24">24 Hours</MenuItem>
            </Select>
          </Box>
          {error && (
            <Alert severity="error" sx={{ fontSize: '0.7rem', mt: 1 }}>
              {error}
            </Alert>
          )}
          {success && (
            <Alert severity="success" sx={{ fontSize: '0.7rem', mt: 1 }}>
              {success}
            </Alert>
          )}
          {wallet.connected ? (
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={isSubmitting || !isAuthenticated || !formData.tokenId}
              sx={{ alignSelf: 'center', px: 2, py: 0.5, fontSize: '0.8rem', mt: 1 }}
            >
              {isSubmitting ? 'Submitting...' : 'Apply to List'}
            </Button>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', fontSize: '0.7rem', mt: 1 }}>
              Please connect your wallet to apply.
            </Typography>
          )}
          {error.includes('TradePort') && (
            <Box sx={{ mt: 1, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                Visit{' '}
                <Link href="https://www.tradeport.xyz" target="_blank" rel="noopener noreferrer">
                  TradePort
                </Link>{' '}
                to withdraw your NFT, then retry. Contact{' '}
                <Link href="https://discord.gg/tradeport" target="_blank" rel="noopener noreferrer">
                  TradePort support
                </Link>{' '}
                if issues persist.
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </ErrorBoundary>
  );
}

export default ApplyForm;