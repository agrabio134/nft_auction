import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Grid, Card, CardMedia, CardContent, Typography, Box, Link } from '@mui/material';
import { mistToSui } from '../utils/helpers';

function NFTGrid({ nfts }) {
  const navigate = useNavigate();

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

  const handleNftClick = (nft) => {
    navigate(`/nft/${nft.nft.collection_id}/${nft.nft.token_id}`, { state: { nft } });
  };

  return (
    <Box className="nft-grid" sx={{ mt: 2, width: '100%', px: { xs: 0, sm: 1 } }}>
      <Grid container spacing={{ xs: 1.5, sm: 2 }} sx={{ mx: 0, width: '100%' }}>
        {nfts.length === 0 && (
          <Grid item xs={12}>
            <Typography variant="body2" sx={{ fontSize: '0.85rem', textAlign: 'center', color: '#B0B3B8' }}>
              No NFTs available for this collection.
            </Typography>
          </Grid>
        )}
        {nfts.map((nft, index) => {
          const tradeportUrl = `https://www.tradeport.xyz/sui/collection/${encodeURIComponent(nft.nft.chain_state?.nft_type || 'unknown')}?bottomTab=trades&tab=items&tokenId=${nft.nft.token_id}`;
          return (
            <Grid item xs={12} sm={6} md={4} key={index}>
              <Card
                onClick={() => handleNftClick(nft)}
                sx={{
                  bgcolor: 'rgba(255,255,255,0.03)',
                  borderRadius: 2,
                  p: 1,
                  border: '1px solid #FF4DA6',
                  transition: 'transform 0.3s',
                  cursor: 'pointer',
                  '&:hover': { transform: 'translateY(-5px)', boxShadow: '0 4px 12px rgba(255,0,122,0.5)' },
                }}
              >
                <Box sx={{ position: 'relative' }}>
                  <CardMedia
                    component="img"
                    sx={{
                      height: { xs: 180, sm: 200 },
                      width: '100%',
                      objectFit: 'contain',
                      borderRadius: 1,
                      border: '1px solid rgba(255,77,166,0.3)',
                    }}
                    image={fixImageUrl(nft.nft.media_url)}
                    alt={nft.nft.name || 'Unknown NFT'}
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
                    onClick={(e) => e.stopPropagation()}
                  >
                    <img
                      src="/tradeport-logo.png"
                      alt="Tradeport Logo"
                      className="tradeport-logo"
                    />
                  </Link>
                </Box>
                <CardContent sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.5, color: '#F8FAFC' }}>
                  <Typography
                    variant="h6"
                    sx={{
                      fontFamily: '"Poppins", sans-serif',
                      fontWeight: 700,
                      fontSize: { xs: '1rem', sm: '1.1rem' },
                    }}
                  >
                    {nft.nft.name || 'Unknown NFT'}
                  </Typography>
                  <Typography variant="body2" sx={{ fontSize: '0.8rem', opacity: 0.8 }}>
                    Price: {mistToSui(nft.price) || 'N/A'} SUI
                  </Typography>
                  <Typography variant="body2" sx={{ fontSize: '0.8rem', opacity: 0.8 }}>
                    Ranking: {nft.nft.ranking || 'N/A'} / 10,000
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}

export default NFTGrid;