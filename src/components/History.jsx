import React, { useState, useEffect } from 'react';
import { useWallet } from '@suiet/wallet-kit';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';
import { Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Button, Alert, Paper } from '@mui/material';
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

function History() {
  const wallet = useWallet();
  const [auctions, setAuctions] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const fetchAuctions = async () => {
      if (!wallet.connected || !wallet.account?.address) {
        setError('Please connect your wallet to view history.');
        return;
      }
      try {
        const q = query(
          collection(db, 'auctions'),
          where('seller', '==', wallet.account.address)
        );
        const querySnapshot = await getDocs(q);
        const auctionList = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));
        setAuctions(auctionList);
      } catch (err) {
        setError('Failed to fetch auction history.');
        Sentry.captureException(err);
      }
    };

    fetchAuctions();
  }, [wallet.connected, wallet.account?.address]);

  const handleCancelRequest = async (auctionId) => {
    try {
      const auctionRef = doc(db, 'auctions', auctionId);
      await updateDoc(auctionRef, {
        status: 'cancel_requested',
        cancelRequestedAt: new Date().toISOString(),
      });
      setSuccess('Cancel request submitted. The admin will review your request.');
      setAuctions(auctions.map(auction =>
        auction.id === auctionId
          ? { ...auction, status: 'cancel_requested' }
          : auction
      ));
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to submit cancel request.');
      Sentry.captureException(err);
      setTimeout(() => setError(''), 3000);
    }
  };

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', mt: 2, p: { xs: 1, sm: 2 } }}>
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
        Auction History
      </Typography>
      {error && (
        <Alert severity="error" sx={{ fontSize: '0.7rem', mb: 2 }}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ fontSize: '0.7rem', mb: 2 }}>
          {success}
        </Alert>
      )}
      <TableContainer component={Paper}>
        <Table sx={{ minWidth: 650 }} aria-label="auction history table">
          <TableHead>
            <TableRow>
              <TableCell>Receipt ID</TableCell>
              <TableCell>NFT Name</TableCell>
              <TableCell>Starting Bid (SUI)</TableCell>
              <TableCell>Duration (Hours)</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Priority</TableCell>
              <TableCell>Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {auctions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                    No auctions found.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              auctions.map((auction) => (
                <TableRow key={auction.id}>
                  <TableCell>{auction.receiptId}</TableCell>
                  <TableCell>{auction.name}</TableCell>
                  <TableCell>{(auction.startingBid / 1_000_000_000).toFixed(2)}</TableCell>
                  <TableCell>{auction.auctionDuration}</TableCell>
                  <TableCell>{auction.status}</TableCell>
                  <TableCell>{auction.isPriority ? 'Yes' : 'No'}</TableCell>
                  <TableCell>
                    {auction.status === 'pending' && (
                      <Button
                        variant="outlined"
                        color="secondary"
                        size="small"
                        onClick={() => handleCancelRequest(auction.id)}
                        sx={{ fontSize: '0.7rem' }}
                      >
                        Request Cancel
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export default History;