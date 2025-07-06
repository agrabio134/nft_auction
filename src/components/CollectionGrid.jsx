import React, { useState } from 'react';
import {
  Grid,
  Card,
  CardMedia,
  CardContent,
  Typography,
  Button,
  Box,
  Alert,
  IconButton,
  CardActionArea,
  Tooltip,
} from '@mui/material';
import ViewListIcon from '@mui/icons-material/ViewList';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import { useNavigate } from 'react-router-dom';
import { mistToSui } from '../utils/helpers';

function CollectionGrid({ collections, onSelectCollection }) {
  const [viewMode, setViewMode] = useState('grid');
  const navigate = useNavigate();

  const fixImageUrl = (url, collectionSlug) => {
    if (!url || typeof url !== 'string' || url.trim() === '') {
      return '/collection_placeholder.png';
    }
    if (collectionSlug === '0x9f48e186b1527bd164960a03f392c14669acfd1ef560fb6138ad0918e6e712a3') {
      return 'https://cdn.tradeport.xyz/?url=https%3A%2F%2Ftradeport.mypinata.cloud%2Fipfs%2Fbafkreibscwog6huz2pwwbedhrx5lqrzkemtrmfdw5ccu5qfadz6ox6keua%3FpinataGatewayToken%3D5Uc_j2QFWW75kVPmXB6eWCJ0aVZmc4o9QAq5TiuPfMHZQLKa_VNL3uaXj5NKrq0w%26img-width%3D1200%26img-height%3D630%26img-fit%3Dcover%26img-quality%3D80%26img-onerror%3Dredirect%26img-fit%3Dpad%26img-format%3Dwebp&profile=undefined&mime-type=image';
    }
    if (collectionSlug === 'bored-toilet-club') {
      return 'https://static.wixstatic.com/media/dd1567_a18892f00fa444cdae7e8dbcbd533564~mv2.png/v1/fill/w_192,h_192,lg_1,usm_0.66_1.00_0.01/dd1567_a18892f00fa444cdae7e8dbcbd533564~mv2.png';
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    if (url.startsWith('ipfs://')) {
      return `https://ipfs.io/ipfs/${url.replace('ipfs://', '')}`;
    }
    if (url.startsWith('walrus://')) {
      return `https://walrus.tusky.io/${url.replace('walrus://', '')}`;
    }
    return `https://walrus.tusky.io/${url.replace(/^\/+/, '')}`;
  };

  const toggleViewMode = () => {
    setViewMode(viewMode === 'grid' ? 'list' : 'grid');
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Tooltip title={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}>
          <IconButton
            onClick={toggleViewMode}
            aria-label={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
            color="primary"
          >
            {viewMode === 'grid' ? <ViewListIcon /> : <ViewModuleIcon />}
          </IconButton>
        </Tooltip>
      </Box>
      {collections.length === 0 && (
        <Alert severity="info" sx={{ mb: 2, bgcolor: 'background.paper' }}>
          No collections available.
        </Alert>
      )}
      <Grid container spacing={3} sx={{ flexDirection: viewMode === 'grid' ? 'row' : 'column' }}>
        {collections.map((collection) => {
          const collectionUrl = `https://www.tradeport.xyz/sui/collection/${encodeURIComponent(collection.slug)}`;
          return (
            <Grid
              item
              xs={12}
              sm={viewMode === 'grid' ? 6 : 12}
              md={viewMode === 'grid' ? 4 : 12}
              key={collection.id || collection.slug}
            >
              <Card
                sx={{
                  display: viewMode === 'list' ? 'flex' : 'block',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                  '&:hover': { boxShadow: 6 },
                }}
              >
                <CardActionArea
                  onClick={() => {
                    onSelectCollection(collection);
                   
                  }}
                >
                  <CardMedia
                    component="img"
                    sx={{
                      height: viewMode === 'grid' ? 140 : 100,
                      width: viewMode === 'list' ? 150 : '100%',
                      objectFit: 'cover',
                      borderRadius: 1,
                    }}
                    image={fixImageUrl(collection.cover_url, collection.slug)}
                    alt={collection.title || 'Unknown Collection'}
                    onError={(e) => {
                      e.target.src = '/collection_placeholder.png';
                      e.target.alt = 'Placeholder for unavailable collection image';
                    }}
                    loading="lazy"
                  />
                </CardActionArea>
                <CardContent
                  sx={{
                    flex: viewMode === 'list' ? 1 : 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="h6" sx={{ fontWeight: 600, fontSize: { xs: '1rem', sm: '1.2rem' } }}>
                      {collection.title || 'Unknown Collection'}
                    </Typography>
                    {collection.verified && (
                      <Tooltip title="Verified Collection">
                        <img
                          src="https://cdn.tradeport.xyz/?url=https%3A%2F%2Fwww.tradeport.xyz%2Ficons%2Forange%2Ficons-verified.svg"
                          alt="Verified Collection"
                          style={{ width: 20, height: 20 }}
                        />
                      </Tooltip>
                    )}
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    Floor: {mistToSui(collection.floor) || 'N/A'} SUI
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Volume: {mistToSui(collection.volume) || 'N/A'} SUI
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Supply: {collection.supply || 'N/A'}
                  </Typography>
                  <Box sx={{ mt: 'auto', display: 'flex', gap: 1 }}>
       
                      <>
                        <Button
                          variant="contained"
                          fullWidth
                          onClick={() => {
                            onSelectCollection(collection);
                            navigate(`/collection/${collection.slug}`);
                          }}
                          sx={{ fontSize: '0.85rem' }}
                          aria-label={`View NFTs for ${collection.title}`}
                        >
                          View NFTs
                        </Button>
                        <Tooltip title="Visit on Tradeport">
                          <Button
                            variant="outlined"
                            href={collectionUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{ minWidth: 'auto', p: 1 }}
                            aria-label={`Visit ${collection.title} on Tradeport`}
                          >
                            <img
                              src="/tradeport-logo.png"
                              alt="Tradeport Logo"
                              style={{ width: 24, height: 24 }}
                            />
                          </Button>
                        </Tooltip>
                      </>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}

export default CollectionGrid;