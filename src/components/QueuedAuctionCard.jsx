import React from 'react';
import { Box, Card, CardMedia, CardContent, Typography, Link } from '@mui/material';

function QueuedAuctionCard({ auction, isPrimary, opacity }) {
  const fixImageUrl = (url) => {
    if (!url || typeof url !== 'string' || url.trim() === '') return '/nft_placeholder.png';
    if (url.startsWith('walrus://')) return `https://walrus.tusky.io/${url.replace('walrus://', '')}`;
    if (!url.startsWith('http://') && !url.startsWith('https://')) return `https://walrus.tusky.io/${url.replace(/^\/+/, '')}`;
    return url;
  };

  const tradeportUrl = `https://www.tradeport.xyz/sui/collection/${encodeURIComponent(auction.collection || 'unknown')}?bottomTab=trades&tab=items&tokenId=${auction.token_id}`;

  return (
    <Card sx={{ maxWidth: { xs: '100%', sm: 250 }, width: '100%', bgcolor: 'rgba(255,255,255,0.03)', p: isPrimary ? 0.75 : 0.5, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: isPrimary ? 0.75 : 0.5, borderRadius: 0.5, border: '1px solid #FF4DA6', boxShadow: `0 2px 6px rgba(255,0,122,${isPrimary ? 0.3 : 0.2})`, opacity: opacity, mt: 0.5, '&:hover': { transform: 'scale(1.02)', boxShadow: `0 4px 10px rgba(255,0,122,${isPrimary ? 0.5 : 0.4})` }, transition: 'transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease' }}>
      <Box sx={{ width: { xs: '100%', sm: '30%' }, mb: { xs: 0.5, sm: 0 }, position: 'relative' }}>
        <CardMedia component="img" sx={{ width: '100%', height: { xs: isPrimary ? 60 : 50, sm: isPrimary ? 80 : 60 }, objectFit: 'contain', borderRadius: 0.5, border: '1px solid rgba(255,77,166,0.3)' }} image={fixImageUrl(auction.media_url)} alt={auction.name || 'Unknown NFT'} onError={(e) => { e.target.src = '/nft_placeholder.png'; e.target.alt = 'Image unavailable'; }} />
        <Link href={tradeportUrl} target="_blank" rel="noopener noreferrer" sx={{ position: 'absolute', bottom: 4, left: 4 }}><img src="/tradeport-logo.png" alt="Tradeport Logo" style={{ width: 20, height: 20 }} /></Link>
      </Box>
      <CardContent sx={{ width: { xs: '100%', sm: '70%' }, display: 'flex', flexDirection: 'column', gap: 0.3, p: isPrimary ? 0.5 : 0.3, color: '#F8FAFC' }}>
        <Typography variant="h6" sx={{ fontFamily: '"Poppins", sans-serif', fontWeight: 600, fontSize: { xs: isPrimary ? '0.85rem' : '0.8rem', sm: isPrimary ? '0.9rem' : '0.85rem' }, textAlign: 'center' }}>{auction.name || 'Unknown NFT'}</Typography>
        <Typography variant="body2" sx={{ fontSize: { xs: isPrimary ? '0.65rem' : '0.6rem', sm: isPrimary ? '0.7rem' : '0.65rem' }, textAlign: 'center', color: '#F8FAFC', opacity: 0.8 }}>{auction.collection ? `Collection: ${auction.collection.slice(0, 6)}...${auction.collection.slice(-6)}` : 'Sui Blockchain'}</Typography>
        <Typography variant="body2" sx={{ fontSize: { xs: isPrimary ? '0.65rem' : '0.6rem', sm: isPrimary ? '0.7rem' : '0.65rem' }, textAlign: 'center', color: '#F8FAFC', opacity: 0.8 }}>Seller: {auction.seller.slice(0, 6)}...${auction.seller.slice(-6)}</Typography>
      </CardContent>
    </Card>
  );
}

export default QueuedAuctionCard;