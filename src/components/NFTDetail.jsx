import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { useWallet } from '@suiet/wallet-kit';
import { initializeApp } from 'firebase/app';
import { getFirestore, query, collection, where, getDocs, updateDoc, doc } from 'firebase/firestore';
import { mistToSui } from '../utils/helpers';
import { Box, Card, CardMedia, CardContent, Typography, Button, Alert, Link, Divider, CircularProgress } from '@mui/material';
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

// Initialize Sui Client for mainnet
const MAINNET_URL = getFullnodeUrl('mainnet');
const suiClient = new SuiClient({ url: MAINNET_URL });

// Clock ID
const CLOCK_ID = '0x6';

// Admin address
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

function NFTDetail() {
  const location = useLocation();
  const navigate = useNavigate();
  const wallet = useWallet();
  const { nft } = location.state || {};
  const [applicationStatus, setApplicationStatus] = useState(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [nftDetails, setNftDetails] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // Validate token ID format
  const isValidTokenId = (tokenId) => {
    return /^0x[a-fA-F0-9]{64}$/.test(tokenId);
  };

  // Estimate gas budget
  const estimateGasBudget = async (tx) => {
    try {
      const dryRun = await suiClient.dryRunTransactionBlock({
        transactionBlock: tx,
      });
      if (dryRun.effects.status.status === 'success') {
        const gasUsed = parseInt(dryRun.effects.gasUsed.computationCost) +
                        parseInt(dryRun.effects.gasUsed.storageCost) -
                        parseInt(dryRun.effects.gasUsed.storageRebate);
        return Math.max(gasUsed * 1.5, 100_000_000); // 50% buffer, min 0.1 SUI
      }
      return 100_000_000; // Fallback
    } catch {
      return 100_000_000; // Fallback
    }
  };

  // Fetch NFT details from Sui
  const fetchNftDetails = useCallback(async (tokenId, retry = true) => {
    if (!isValidTokenId(tokenId)) {
      setError('Invalid Token ID format. Please check and try again.');
      setIsLoading(false);
      setNftDetails({
        objectName: nft?.nft?.name || 'Unknown NFT',
        imgUrl: nft?.nft?.media_url || '',
        type: nft?.nft?.nft_type || 'unknown',
        attributes: [],
        originalKioskId: null,
      });
      return;
    }

    setIsLoading(true);
    try {
      console.log('NFTDetail: Fetching NFT details for tokenId:', tokenId);
      let nftObject;
      try {
        nftObject = await suiClient.getObject({
          id: tokenId,
          options: { showContent: true, showType: true, showOwner: true },
        });
      } catch (err) {
        if (retry) {
          console.warn(`NFTDetail: Retrying NFT fetch for ${tokenId} after 5000ms`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          return await fetchNftDetails(tokenId, false);
        }
        throw new Error(`Failed to fetch NFT: ${err.message}`);
      }

      if (nftObject.error || !nftObject.data) {
        throw new Error(`Failed to fetch NFT object: ${nftObject.error?.message || 'Unknown error'}`);
      }

      console.log('NFTDetail: Sui object response:', nftObject.data);
      const contentFields = nftObject.data.content?.fields || {};
      let attributes = contentFields.attributes?.fields?.contents || [];

      // Parse attributes from VecMap
      if (Array.isArray(attributes)) {
        attributes = attributes.map((entry) => ({
          type: entry.fields.key || 'Unknown',
          value: entry.fields.value || 'N/A',
          rarity: null,
        }));
      } else {
        attributes = [];
      }

      // Check ownership
      const ownerInfo = nftObject.data?.owner;
      let isOwned = false;
      let originalKioskId = null;

      if (ownerInfo?.AddressOwner === wallet.account?.address) {
        console.log('NFTDetail: NFT is directly owned by wallet address:', wallet.account?.address);
        isOwned = true;
      } else if (ownerInfo?.ObjectOwner) {
        console.log('NFTDetail: NFT is owned by ObjectOwner:', ownerInfo.ObjectOwner);
        originalKioskId = ownerInfo.ObjectOwner;
        let kioskObject;
        try {
          kioskObject = await suiClient.getObject({
            id: ownerInfo.ObjectOwner,
            options: { showContent: true, showType: true, showOwner: true },
          });
        } catch (err) {
          console.warn('NFTDetail: Failed to fetch kiosk object:', err.message);
          Sentry.captureException(err);
        }

        if (kioskObject?.data?.type === '0x2::kiosk::Kiosk') {
          console.log('NFTDetail: ObjectOwner is a kiosk:', kioskObject.data);
          const ownedObjects = await suiClient.getOwnedObjects({
            owner: wallet.account?.address,
            filter: { StructType: '0x2::kiosk::KioskOwnerCap' },
            options: { showContent: true },
          });
          const kioskOwnerCap = ownedObjects.data.find(obj => 
            obj.data?.content?.fields?.for === ownerInfo.ObjectOwner
          );
          if (kioskOwnerCap || kioskObject?.data?.owner?.AddressOwner === wallet.account?.address) {
            console.log('NFTDetail: Kiosk ownership verified');
            isOwned = true;
          }
        }
      }

      if (!isOwned) {
        console.warn('NFTDetail: Ownership not verified on-chain. Trusting GraphQL data.');
        isOwned = true; // Trust GraphQL data from MyNFTGrid
      }

      setNftDetails({
        objectName: contentFields.name || nft?.nft?.name || 'Unknown NFT',
        imgUrl: contentFields.url || contentFields.image_url || contentFields.media_url || nft?.nft?.media_url || '',
        type: nftObject.data.type || nft?.nft?.nft_type || 'unknown',
        attributes,
        originalKioskId,
      });
    } catch (err) {
      setError(`Failed to load NFT details: ${err.message}. Using basic data.`);
      Sentry.captureException(err);
      setNftDetails({
        objectName: nft?.nft?.name || 'Unknown NFT',
        imgUrl: nft?.nft?.media_url || '',
        type: nft?.nft?.nft_type || 'unknown',
        attributes: [],
        originalKioskId: null,
      });
    } finally {
      setIsLoading(false);
    }
  }, [nft, wallet.account?.address]);

  const checkApplicationStatus = async () => {
    if (!wallet.account?.address || !nft?.nft?.token_id) return;

    try {
      const q = query(
        collection(db, 'auctions'),
        where('tokenId', '==', nft.nft.token_id),
        where('seller', '==', wallet.account.address),
      );
      const querySnapshot = await getDocs(q);
      if (!querySnapshot.empty) {
        const application = querySnapshot.docs[0].data();
        setApplicationStatus({ id: querySnapshot.docs[0].id, ...application });
      } else {
        setApplicationStatus(null);
      }
    } catch (err) {
      setError('Failed to check application status.');
      Sentry.captureException(err);
    }
  };

  const fixImageUrl = (url) => {
    if (!url || typeof url !== 'string' || url.trim() === '') {
      return '/nft_placeholder.png';
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    if (url.startsWith('walrus://')) {
      return `https://walrus.tusky.io/${url.replace('walrus://', '')}`;
    }
    return `https://walrus.tusky.io/${url.replace(/^\/+/, '')}`;
  };

  const handleApplyToList = () => {
    if (!nftDetails) {
      setError('NFT details not loaded.');
      return;
    }
    if (!wallet.connected || !wallet.account?.address) {
      setError('Please connect a wallet.');
      return;
    }
    if (wallet.account?.address !== ADMIN_ADDRESS) {
      setError('Only the admin wallet can apply to list NFTs.');
      return;
    }
    navigate('/apply', {
      state: {
        tokenId: nft.nft.token_id,
      },
    });
  };

  const handleUnlock = async () => {
    if (!wallet.connected || !wallet.signAndExecuteTransactionBlock) {
      setError('Please connect a compatible wallet.');
      return;
    }
    if (!applicationStatus || !applicationStatus.kioskId || !applicationStatus.kioskOwnerCapId || !applicationStatus.nftObjectId || !applicationStatus.collection) {
      setError('Missing application data.');
      return;
    }
    setIsUnlocking(true);
    setError('');
    setSuccess('');

    try {
      const tx = new TransactionBlock();
      const nft = tx.moveCall({
        target: `0x2::kiosk::take`,
        arguments: [
          tx.object(applicationStatus.kioskId),
          tx.object(applicationStatus.kioskOwnerCapId),
          tx.pure.id(applicationStatus.nftObjectId),
        ],
        typeArguments: [applicationStatus.collection],
      });
      tx.transferObjects([nft], wallet.account?.address);

      const gasBudget = await estimateGasBudget(tx);
      tx.setGasBudget(gasBudget);

      const result = await wallet.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        requestType: 'WaitForLocalExecution',
        options: { showEffects: true, showObjectChanges: true },
        chain: 'sui:mainnet',
      });

      if (result.errors || result.effects?.status.status !== 'success') {
        throw new Error(`Failed to withdraw NFT: ${JSON.stringify(result.errors || 'Transaction failed')}`);
      }

      await updateDoc(doc(db, 'auctions', applicationStatus.id), {
        status: 'rejected',
        updatedAt: new Date().toISOString(),
      });
      setApplicationStatus(null);
      setSuccess('NFT unlocked successfully!');
    } catch (err) {
      setError(`Failed to unlock NFT: ${err.message}.`);
      Sentry.captureException(err);
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleCancel = async () => {
    if (!wallet.connected || !wallet.signAndExecuteTransactionBlock) {
      setError('Please connect a compatible wallet.');
      return;
    }
    if (!applicationStatus || !applicationStatus.kioskId || !applicationStatus.kioskOwnerCapId || !applicationStatus.nftObjectId || !applicationStatus.collection) {
      setError('Missing application data.');
      return;
    }
    setIsCanceling(true);
    setError('');
    setSuccess('');

    try {
      const tx = new TransactionBlock();
      const nft = tx.moveCall({
        target: `0x2::kiosk::take`,
        arguments: [
          tx.object(applicationStatus.kioskId),
          tx.object(applicationStatus.kioskOwnerCapId),
          tx.pure.id(applicationStatus.nftObjectId),
        ],
        typeArguments: [applicationStatus.collection],
      });
      tx.transferObjects([nft], wallet.account?.address);

      const gasBudget = await estimateGasBudget(tx);
      tx.setGasBudget(gasBudget);

      const withdrawResult = await wallet.signAndExecuteTransactionBlock({
        transactionBlock: tx,
        requestType: 'WaitForLocalExecution',
        options: { showEffects: true, showObjectChanges: true },
        chain: 'sui:mainnet',
      });

      if (withdrawResult.errors || withdrawResult.effects?.status.status !== 'success') {
        throw new Error(`Failed to withdraw NFT: ${JSON.stringify(withdrawResult.errors || 'Transaction failed')}`);
      }

      await updateDoc(doc(db, 'auctions', applicationStatus.id), {
        status: 'canceled',
        updatedAt: new Date().toISOString(),
      });
      setApplicationStatus(null);
      setSuccess('Application canceled and NFT withdrawn.');
    } catch (err) {
      setError(`Failed to cancel application: ${err.message}.`);
      Sentry.captureException(err);
    } finally {
      setIsCanceling(false);
    }
  };

  const handleRetry = () => {
    setError('');
    setSuccess('');
    if (nft?.nft?.token_id) {
      fetchNftDetails(nft.nft.token_id);
    } else {
      setError('No valid Token ID.');
      navigate('/');
    }
  };

  useEffect(() => {
    console.log('NFTDetail: location.state:', location.state);
    console.log('NFTDetail: NFT from location.state:', nft);
    if (nft?.nft?.token_id) {
      fetchNftDetails(nft.nft.token_id);
    } else {
      setError('No valid Token ID provided.');
      setNftDetails({
        objectName: nft?.nft?.name || 'Unknown NFT',
        imgUrl: nft?.nft?.media_url || '',
        type: nft?.nft?.nft_type || 'unknown',
        attributes: [],
        originalKioskId: null,
      });
    }
  }, [nft, fetchNftDetails]);

  useEffect(() => {
    if (wallet.connected && wallet.account?.address && nft?.nft?.token_id) {
      checkApplicationStatus();
    }
  }, [wallet.connected, wallet.account?.address, nft?.nft?.token_id]);

  if (!nft || !nft.nft) {
    return (
      <Box sx={{ maxWidth: 550, mx: 'auto', mt: 2 }}>
        <Typography variant="body2" color="error" sx={{ textAlign: 'center', fontSize: '0.8rem' }}>
          No NFT data available.
        </Typography>
      </Box>
    );
  }

  const tradeportUrl = `https://www.tradeport.xyz/sui/collection/${encodeURIComponent(nftDetails?.type || nft.nft?.nft_type || 'unknown')}?bottomTab=trades&tab=items&tokenId=${nft.nft.token_id}`;
  const isAdminWallet = wallet.connected && wallet.account?.address === ADMIN_ADDRESS;

  return (
    <ErrorBoundary>
      <Box sx={{ maxWidth: 700, mx: 'auto', mt: 2, p: { xs: 1, sm: 2 } }}>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Card sx={{ bgcolor: 'background.paper', borderRadius: 2, p: 1.5 }}>
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
              {nftDetails?.objectName || nft.nft?.name || 'Unknown NFT'}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5 }}>
              <Box sx={{ width: { xs: '100%', sm: '40%' }, position: 'relative' }}>
                <CardMedia
                  component="img"
                  sx={{
                    width: '100%',
                    height: { xs: 160, sm: 200 },
                    objectFit: 'contain',
                    borderRadius: 1,
                  }}
                  image={fixImageUrl(nftDetails?.imgUrl || nft.nft?.media_url)}
                  alt={nftDetails?.objectName || nft.nft?.name || 'Unknown NFT'}
                  onError={(e) => {
                    e.target.src = '/nft_placeholder.png';
                    e.target.alt = 'Image unavailable';
                  }}
                />
                <Link
                  href={tradeportUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ position: 'absolute', bottom: 8, left: 8 }}
                >
                  <img
                    src="/tradeport-logo.png"
                    alt="Tradeport Logo"
                    style={{ height: 24 }}
                  />
                </Link>
              </Box>
              <CardContent sx={{ width: { xs: '100%', sm: '60%' }, p: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
                  <strong>Token ID:</strong> {nft.nft.token_id}
                </Typography>
                <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
                  <strong>Collection:</strong> {nftDetails?.type ? `${nftDetails.type.slice(0, 6)}...${nftDetails.type.slice(-6)}` : 'N/A'}
                </Typography>
                <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
                  <strong>Price:</strong> {nft.price ? mistToSui(nft.price) : 'N/A'} SUI
                </Typography>
                <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
                  <strong>Ranking:</strong> {nft.nft?.ranking || 'N/A'} / 10,000
                </Typography>
                <Divider sx={{ my: 0.5 }} />
                <Box>
                  {error && (
                    <Alert severity="error" sx={{ mb: 1, fontSize: '0.7rem' }}>
                      {error}
                      <Button
                        size="small"
                        onClick={handleRetry}
                        sx={{ ml: 1, fontSize: '0.7rem' }}
                      >
                        Retry
                      </Button>
                    </Alert>
                  )}
                  {success && (
                    <Alert severity="success" sx={{ mb: 1, fontSize: '0.7rem' }}>
                      {success}
                    </Alert>
                  )}
                  {nftDetails?.attributes?.length > 0 ? (
                    nftDetails.attributes.map((attr, index) => (
                      <Box key={index} sx={{ display: 'flex', gap: 0.5, mb: 0.3, flexWrap: 'wrap', fontSize: '0.7rem' }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                          {attr.type}:
                        </Typography>
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          {attr.value}
                        </Typography>
                        {attr.rarity && (
                          <Typography variant="body2" sx={{ color: 'secondary.main' }}>
                            {(attr.rarity * 100).toFixed(2)}%
                          </Typography>
                        )}
                      </Box>
                    ))
                  ) : (
                    <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                      No attributes available
                    </Typography>
                  )}
                </Box>
                {applicationStatus ? (
                  <>
                    <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
                      <strong>Application Status:</strong> {applicationStatus.status}
                    </Typography>
                    {applicationStatus.status === 'pending' && (
                      <Button
                        variant="contained"
                        color="primary"
                        size="small"
                        onClick={handleCancel}
                        disabled={isCanceling || isLoading}
                        sx={{ alignSelf: 'flex-start', px: 1.5, py: 0.5, fontSize: '0.8rem' }}
                      >
                        {isCanceling ? 'Canceling...' : 'Cancel Application'}
                      </Button>
                    )}
                    {applicationStatus.status === 'rejected' && (
                      <Button
                        variant="contained"
                        color="primary"
                        size="small"
                        onClick={handleUnlock}
                        disabled={isUnlocking || isLoading}
                        sx={{ alignSelf: 'flex-start', px: 1.5, py: 0.5, fontSize: '0.8rem' }}
                      >
                        {isUnlocking ? 'Unlocking...' : 'Unlock NFT'}
                      </Button>
                    )}
                    {applicationStatus.status === 'canceled' && (
                      <Button
                        variant="contained"
                        color="primary"
                        size="small"
                        onClick={handleApplyToList}
                        disabled={isLoading || !nftDetails || !isAdminWallet}
                        sx={{ alignSelf: 'flex-start', px: 1.5, py: 0.5, fontSize: '0.8rem' }}
                      >
                        Apply to List
                      </Button>
                    )}
                  </>
                ) : (
                  <Button
                    variant="contained"
                    color="primary"
                    size="small"
                    onClick={handleApplyToList}
                    disabled={isLoading || !nftDetails || !isAdminWallet}
                    sx={{ alignSelf: 'flex-start', px: 1.5, py: 0.5, fontSize: '0.8rem' }}
                  >
                    Apply to List
                  </Button>
                )}
              </CardContent>
            </Box>
          </Card>
        )}
      </Box>
    </ErrorBoundary>
  );
}

export default NFTDetail;