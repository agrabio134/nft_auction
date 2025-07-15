import React from 'react';
import { Box, Typography, Container, Link } from '@mui/material';

function Terms() {
  return (
    <Container sx={{ py: { xs: 2, md: 3 }, maxWidth: 'md' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography
          variant="h5"
          sx={{
            fontWeight: 700,
            color: 'primary.main',
            mb: 2,
            textAlign: 'center',
            fontFamily: '"Poppins", "Inter", sans-serif',
          }}
        >
          Terms and Conditions
        </Typography>
        <Typography variant="body1" sx={{ color: 'text.primary', mb: 2 }}>
          Welcome to Lofita Auction. By using our platform, you agree to the following terms and conditions:
        </Typography>
        <Box component="ol" sx={{ pl: 4, color: 'text.primary' }}>
          <li>
            <Typography variant="body2" sx={{ mb: 1 }}>
              <strong>NFT Listing:</strong> When you apply to list an NFT for auction, it will be transferred to a sharable admin kiosk controlled by Lofita Auction. This allows us to manage the auction process securely.
            </Typography>
          </li>
          <li>
            <Typography variant="body2" sx={{ mb: 1 }}>
              <strong>Priority Listing:</strong> Opting for priority listing requires transferring 100,000 LOFITA tokens to the platform's treasury. These tokens are non-refundable and used to prioritize your auction listing.
            </Typography>
          </li>
          <li>
            <Typography variant="body2" sx={{ mb: 1 }}>
              <strong>Auction Process:</strong> All auctions are subject to approval by the Lofita Auction admin team. You may request to cancel a pending auction, but approval is at the discretion of the admin.
            </Typography>
          </li>
          <li>
            <Typography variant="body2" sx={{ mb: 1 }}>
              <strong>Fees:</strong> Gas fees for transactions (e.g., NFT transfers, LOFITA token transfers) are your responsibility. Ensure you have sufficient SUI and LOFITA tokens in your wallet.
            </Typography>
          </li>
          <li>
            <Typography variant="body2" sx={{ mb: 1 }}>
              <strong>Liability:</strong> Lofita Auction is not responsible for any loss or damage resulting from platform use, including technical issues or transaction failures.
            </Typography>
          </li>
          <li>
            <Typography variant="body2" sx={{ mb: 1 }}>
              <strong>Changes:</strong> We reserve the right to modify these terms at any time. Continued use of the platform constitutes acceptance of the updated terms.
            </Typography>
          </li>
        </Box>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2, textAlign: 'center' }}>
          For questions or support, contact us via{' '}
          <Link href="https://t.me/LofitaYETI" target="_blank" rel="noopener noreferrer">
            Telegram
          </Link>.
        </Typography>
      </Box>
    </Container>
  );
}

export default Terms;