import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useWallet } from '@suiet/wallet-kit';
import { useLocation, useNavigate } from 'react-router-dom';
import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { initializeApp } from 'firebase/app';
import { getFirestore, addDoc, collection } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { Box, Typography, TextField, Select, MenuItem, Button, Alert, Link, Checkbox, FormControlLabel, Modal, Paper, Tooltip } from '@mui/material';
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

// Admin address
const ADMIN_ADDRESS = '0x3a74d8e94bf49bb738a3f1dedcc962ed01c89f78d21c01d87ee5e6980f0750e9';

// Move package ID
const PACKAGE_ID = '0x192a27396fd86678ae2206651a3fcd2f75f14ac6adefadd51000df385ab55131';

// LOFITA token configuration (static for now)
const LOFITA_TOKEN_ADDRESS = '0xLOFITA_TOKEN_ADDRESS'; // Replace with actual LOFITA token address
const TREASURY_ADDRESS = '0xTREASURY_ADDRESS'; // Replace with actual treasury address
const LOFITA_AMOUNT = 100_000_000_000_000; // 100K LOFITA tokens (assuming 9 decimals)

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
    auctionDuration: '8',
    isPriority: false,
    agreeTerms: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [receiptData, setReceiptData] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [termsModalOpen, setTermsModalOpen] = useState(false);
  const [termsViewed, setTermsViewed] = useState(false);
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
      setError('Failed to connect wallet. Try Sui Wallet.');
      Sentry.captureException(wallet.error);
    }
  }, [wallet.error]);

  // Redirect after success and modal close
  useEffect(() => {
    if (success && !modalOpen) {
      const timer = setTimeout(() => {
        navigate('/history');
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [success, modalOpen, navigate]);

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

  // Check SUI balance
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

  // Check LOFITA balance
  const checkLofitaBalance = async () => {
    try {
      const balance = await suiClient.getBalance({
        owner: wallet.account?.address,
        coinType: LOFITA_TOKEN_ADDRESS,
      });
      const totalBalance = parseInt(balance.totalBalance);
      console.log('ApplyForm: LOFITA balance:', totalBalance);
      return totalBalance >= LOFITA_AMOUNT;
    } catch (err) {
      setError(`Failed to check LOFITA balance: ${err.message}`);
      Sentry.captureException(err);
      return false;
    }
  };

  // Fetch NFT object
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

  // Validate kiosk
  const validateKiosk = async (kioskId, retry = false) => {
    try {
      const kioskObject = await suiClient.getObject({
        id: kioskId,
        options: { showContent: true, showType: true, showOwner: true },
      });
      if (kioskObject.error || !kioskObject.data || kioskObject.data.type !== '0x2::kiosk::Kiosk') {
        throw new Error(`Kiosk ${kioskId} is invalid or not a kiosk.`);
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

  // Check kiosk status
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
          message: `NFT is ${isListed ? 'listed' : 'locked'} in kiosk ${kioskId}. Withdraw it via TradePort.`,
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
    const { name, value, type, checked } = e.target;
    if (name === 'agreeTerms' && !termsViewed) {
      setError('Please read the Terms and Conditions before agreeing.');
      return;
    }
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value,
    });
    setError('');
    setSuccess('');
  };

  const handleTermsOpen = () => {
    setTermsModalOpen(true);
    setTermsViewed(true);
    setError('');
  };

  const handleTermsClose = () => {
    setTermsModalOpen(false);
  };

  const handleModalClose = () => {
    setModalOpen(false);
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
    if (!formData.agreeTerms) {
      setError('You must agree to the Terms and Conditions.');
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

      // Initialize transaction block
      let tx = new TransactionBlock();

      // If NFT is in a kiosk, withdraw it
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
        } else {
          throw new Error(`You do not own the KioskOwnerCap for kiosk ${sourceKioskId}. Withdraw via TradePort.`);
        }
      }

      // Deposit NFT to admin address
      if (!isInKiosk) {
        tx.moveCall({
          target: `${PACKAGE_ID}::marketplace::deposit_nft_to_admin`,
          arguments: [tx.object(nftObjectId)],
          typeArguments: [nftCollection],
        });
      }

      // Execute transaction
      const gasBudget = await estimateGasBudget(tx);
      tx.setGasBudget(gasBudget);
      const depositResult = await wallet.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        requestType: 'WaitForLocalExecution',
        options: { showObjectChanges: true, showEffects: true },
        chain: 'sui:mainnet',
      });
      if (depositResult.errors) {
        throw new Error(`Failed to process transaction: ${JSON.stringify(depositResult.errors)}.`);
      }
      console.log('ApplyForm: Transaction executed, deposited NFT to admin address:', ADMIN_ADDRESS);

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
        transferredTo: ADMIN_ADDRESS,
        isPriority: formData.isPriority,
        receiptId: `REC-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      };
      try {
        const docRef = await addDoc(collection(db, 'auctions'), applicationData);
        setReceiptData({
          receiptId: applicationData.receiptId,
          tokenId: formData.tokenId,
          startingBid: startingBid,
          auctionDuration: applicationData.auctionDuration,
          isPriority: formData.isPriority,
          submittedAt: applicationData.submittedAt,
          seller: applicationData.seller,
          name: applicationData.name,
        });
        setModalOpen(true);
        setSuccess(`NFT submitted for auction approval! Receipt ID: ${applicationData.receiptId}`);
      } catch (firestoreErr) {
        setError(`Failed to save auction data: ${firestoreErr.message}.`);
        Sentry.captureException(firestoreErr);
      }
      setFormData({ tokenId: '', startingBid: '', auctionDuration: '2', isPriority: false, agreeTerms: false });
    } catch (err) {
      setError(`Failed to submit application: ${err.message}. If the issue persists, contact support.`);
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
              Auction Duration
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
              <MenuItem value="8">8 Hours</MenuItem>
              <MenuItem value="12">12 Hours</MenuItem>
              <MenuItem value="24">24 Hours</MenuItem>
              <MenuItem value="48">2 Days</MenuItem>
              <MenuItem value="72">3 Days</MenuItem>
              <MenuItem value="120">5 Days</MenuItem>
              <MenuItem value="168">1 Week</MenuItem>
            </Select>
          </Box>
          <Box>
            <Tooltip title="*FREE LISTING until July 20, 2025">
              <span>
                <FormControlLabel
                  control={
                    <Checkbox
                      name="isPriority"
                      checked={formData.isPriority}
                      disabled={true}
                      size="small"
                    />
                  }
                  label={
                    <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'text.primary' }}>
                      Priority Listing (Requires 100K LOFITA tokens)
                    </Typography>
                  }
                />
              </span>
            </Tooltip>
          </Box>
          <Box>
            <FormControlLabel
              control={
                <Checkbox
                  name="agreeTerms"
                  checked={formData.agreeTerms}
                  onChange={handleChange}
                  disabled={!wallet.connected}
                  size="small"
                />
              }
              label={
                <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'text.primary' }}>
                  I agree to the{' '}
                  <Link
                    component="button"
                    onClick={handleTermsOpen}
                    sx={{ fontSize: '0.8rem', color: 'primary.main', textDecoration: 'underline' }}
                  >
                    Terms and Conditions
                  </Link>
                  . The NFT will be transferred to a sharable admin kiosk.
                </Typography>
              }
            />
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
              disabled={isSubmitting || !isAuthenticated || !formData.tokenId || !formData.agreeTerms}
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
        {/* Receipt Modal */}
        <Modal
          open={modalOpen}
          onClose={handleModalClose}
          aria-labelledby="receipt-modal-title"
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Paper
            sx={{
              maxWidth: 400,
              p: 3,
              bgcolor: 'background.paper',
              borderRadius: 2,
              boxShadow: 24,
              textAlign: 'center',
            }}
          >
            <Typography
              id="receipt-modal-title"
              variant="h6"
              sx={{ fontFamily: '"Poppins", "Roboto", sans-serif', fontWeight: 700, mb: 2 }}
            >
              Auction Submission Receipt
            </Typography>
            {receiptData && (
              <Box sx={{ textAlign: 'left', mb: 2 }}>
                <Typography variant="body2" sx={{ fontSize: '0.8rem', mb: 1 }}>
                  <strong>Receipt ID:</strong> {receiptData.receiptId}
                </Typography>
                <Typography variant="body2" sx={{ fontSize: '0.8rem', mb: 1 }}>
                  <strong>NFT Name:</strong> {receiptData.name}
                </Typography>
                <Typography variant="body2" sx={{ fontSize: '0.8rem', mb: 1 }}>
                  <strong>Token ID:</strong> {receiptData.tokenId.slice(0, 6)}...{receiptData.tokenId.slice(-6)}
                </Typography>
                <Typography variant="body2" sx={{ fontSize: '0.8rem', mb: 1 }}>
                  <strong>Starting Bid:</strong> {receiptData.startingBid.toFixed(2)} SUI
                </Typography>
                <Typography variant="body2" sx={{ fontSize: '0.8rem', mb: 1 }}>
                  <strong>Auction Duration:</strong> {receiptData.auctionDuration} Hours
                </Typography>
                <Typography variant="body2" sx={{ fontSize: '0.8rem', mb: 1 }}>
                  <strong>Priority Listing:</strong> {receiptData.isPriority ? 'Yes' : 'No'}
                </Typography>
                <Typography variant="body2" sx={{ fontSize: '0.8rem', mb: 1 }}>
                  <strong>Submitted At:</strong> {new Date(receiptData.submittedAt).toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: 'numeric',
                    hour12: true,
                  })}
                </Typography>
                <Typography variant="body2" sx={{ fontSize: '0.8rem', mb: 1 }}>
                  <strong>Seller Address:</strong> {receiptData.seller.slice(0, 6)}...{receiptData.seller.slice(-6)}
                </Typography>
              </Box>
            )}
            <Button
              variant="contained"
              color="primary"
              onClick={handleModalClose}
              sx={{ fontSize: '0.8rem', px: 2, py: 0.5 }}
            >
              Close
            </Button>
          </Paper>
        </Modal>
        {/* Terms and Conditions Modal */}
        <Modal
          open={termsModalOpen}
          onClose={handleTermsClose}
          aria-labelledby="terms-modal-title"
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Paper
            sx={{
              maxWidth: 600,
              maxHeight: '80vh',
              p: 3,
              bgcolor: 'background.paper',
              borderRadius: 2,
              boxShadow: 24,
              overflowY: 'auto',
            }}
          >
            <Typography
              id="terms-modal-title"
              variant="h6"
              sx={{ fontFamily: '"Poppins", "Roboto", sans-serif', fontWeight: 700, mb: 2, color: 'text.primary' }}
            >
              Terms and Conditions
            </Typography>
            <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'text.secondary', mb: 2 }}>
              By using Lofita Auction, you agree to the following terms and conditions:
            </Typography>
            <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'text.secondary', mb: 1 }}>
              <strong>1. Acceptance of Terms</strong><br />
              By accessing or using the Lofita Auction platform, you agree to be bound by these Terms and Conditions. If you do not agree, you may not use the platform.
            </Typography>
            <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'text.secondary', mb: 1 }}>
              <strong>2. NFT Listing and Transfer</strong><br />
              When listing an NFT for auction, you agree to transfer the NFT to a sharable admin kiosk managed by Lofita Auction. You represent that you are the rightful owner of the NFT or have the authority to list it.
            </Typography>
            <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'text.secondary', mb: 1 }}>
              <strong>3. Fees and Payments</strong><br />
              Listing an NFT may require gas fees on the Sui blockchain. Priority listings may require LOFITA tokens as specified. All payments are non-refundable unless otherwise stated.
            </Typography>
            <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'text.secondary', mb: 1 }}>
              <strong>4. User Responsibilities</strong><br />
              You are responsible for maintaining the security of your wallet and ensuring that all information provided is accurate. Lofita Auction is not liable for any loss due to unauthorized access to your wallet.
            </Typography>
            <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'text.secondary', mb: 1 }}>
              <strong>5. Platform Availability</strong><br />
              Lofita Auction does not guarantee uninterrupted access to the platform and may perform maintenance or updates that temporarily restrict access.
            </Typography>
            <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'text.secondary', mb: 2 }}>
              <strong>6. Limitation of Liability</strong><br />
              Lofita Auction is not liable for any indirect, incidental, or consequential damages arising from your use of the platform, including loss of NFTs or funds due to blockchain errors or wallet issues.
            </Typography>
            <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'text.secondary', mb: 2 }}>
              <strong>Contact</strong><br />
              For questions or support, contact us via our <Link href="https://discord.gg/lofita" target="_blank" rel="noopener noreferrer">Discord</Link>.
            </Typography>
            <Button
              variant="contained"
              color="primary"
              onClick={handleTermsClose}
              sx={{ fontSize: '0.8rem', px: 2, py: 0.5, display: 'block', mx: 'auto' }}
            >
              Close
            </Button>
          </Paper>
        </Modal>
      </Box>
    </ErrorBoundary>
  );
}

export default ApplyForm;