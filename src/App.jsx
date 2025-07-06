import { useState, useEffect } from 'react';
import { useQuery, gql } from '@apollo/client';
import { ConnectButton, useWallet } from '@suiet/wallet-kit';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useParams } from 'react-router-dom';
import {
  AppBar,
  Toolbar,
  Typography,
  Container,
  Box,
  Drawer,
  List,
  ListItem,
  ListItemText,
  IconButton,
  useMediaQuery,
  useTheme,
  Alert,
  CssBaseline,
  ThemeProvider,
  createTheme,
  Button,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import MyNFTGrid from './components/MyNFTGrid';
import CollectionGrid from './components/CollectionGrid';
import SearchBar from './components/SearchBar';
import ApplyForm from './components/ApplyForm';
import AdminView from './components/AdminView';
import NFTDetail from './components/NFTDetail';
import LiveAuction from './components/LiveAuction';
import '@suiet/wallet-kit/style.css'; // Default SUI Wallet Kit CSS
import './suiet-wallet-kit-custom.css'; // Custom CSS

// GraphQL Queries
const FETCH_COLLECTIONS = gql`
  query fetchCollectionInfo($slug: String) {
    sui {
      collections(
        where: {
          _or: [{ semantic_slug: { _eq: $slug } }, { slug: { _eq: $slug } }]
        }
      ) {
        id
        title
        slug
        semantic_slug
        description
        floor
        volume
        usd_volume
        cover_url
        supply
        verified
        discord
        twitter
        website
      }
    }
  }
`;

const FETCH_LISTINGS = gql`
  query fetchCollectionListings($collectionId: uuid!) {
    sui {
      listings(
        where: {
          collection_id: { _eq: $collectionId }
          listed: { _eq: true }
        }
        order_by: { price: asc_nulls_last }
      ) {
        id
        price
        price_str
        block_time
        seller
        market_name
        nonce
        nft {
          id
          token_id
          name
          media_url
          media_type
          ranking
          owner
          chain_state
          collection_id
        }
      }
    }
  }
`;

const FETCH_WALLET_NFTS = gql`
  query fetchWalletNFTs($owner: String!) {
    sui {
      nfts(
        where: {
          owner: { _eq: $owner }
        }
      ) {
        id
        token_id
        name
        media_url
        media_type
        ranking
        owner
        collection_id
        chain_state
      }
    }
  }
`;

// Custom Material-UI Theme (Dark)
const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#FF007A' },
    secondary: { main: '#A855F7' },
    background: { default: '#1A1A1A', paper: '#212121' },
    text: { primary: '#F8FAFC', secondary: '#B0B3B8' },
  },
  typography: {
    fontFamily: '"Poppins", "Inter", sans-serif',
    h5: { fontWeight: 700 },
    h6: { fontWeight: 600 },
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: { backgroundColor: '#1A1A1A', boxShadow: '0 2px 4px rgba(0,0,0,0.3)' },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { transition: 'transform 0.3s, box-shadow 0.3s', backgroundColor: '#212121' },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { textTransform: 'none', borderRadius: 8 },
      },
    },
  },
});

function App() {
  const wallet = useWallet();
  const [filteredData, setFilteredData] = useState([]);
  const [activeFilter, setActiveFilter] = useState('auctions');
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const themeInstance = useTheme();
  const isMobile = useMediaQuery(themeInstance.breakpoints.down('md'));

  // Mock admin wallet address
  const ADMIN_ADDRESS = '0x3a74d8e94bf49bb738a3f1dedcc962ed01c89f78d21c01d87ee5e6980f0750e9';

  useEffect(() => {
    if (wallet.connected && wallet.account?.address === ADMIN_ADDRESS) {
      setIsAdmin(true);
    } else {
      setIsAdmin(false);
    }
  }, [wallet.connected, wallet.account]);

  // Fetch collections
  const { data: yetisData, loading: yetisLoading, error: yetisError } = useQuery(FETCH_COLLECTIONS, {
    variables: { slug: '0xb07b09b016d28f989b6adda8069096da0c0a0ff6490f6e0866858c023b061bee::mystic_yeti::MysticYeti' },
    onError: (error) => console.error('Mystic Yetis query error:', error.message),
  });

  const { data: dooniesData, loading: dooniesLoading, error: dooniesError } = useQuery(FETCH_COLLECTIONS, {
    variables: { slug: '0x9f48e186b1527bd164960a03f392c14669acfd1ef560fb6138ad0918e6e712a3' },
    onError: (error) => console.error('Doonies query error:', error.message),
  });



  const collections = [
    ...(yetisData?.sui.collections || []),
    ...(dooniesData?.sui.collections || []),
  ];

  const { loading: listingsLoading, error: listingsError, data: listingsData } = useQuery(FETCH_LISTINGS, {
    variables: { collectionId: selectedCollection?.id || '' },
    skip: !selectedCollection || selectedCollection.slug === 'bored-toilet-club',
    onError: (error) => console.error('Listings query error:', error.message),
  });

  const { loading: walletNftsLoading, error: walletNftsError, data: walletNftsData } = useQuery(FETCH_WALLET_NFTS, {
    variables: { owner: wallet.account?.address },
    skip: !wallet.connected,
    onError: (error) => console.error('Wallet NFTs query error:', error.message),
  });

  useEffect(() => {
    if (wallet.error) {
      console.error('Wallet connection error:', wallet.error);
      alert('Failed to connect wallet. Please try another wallet or check your connection.');
    }
    if (wallet.connected) {
      console.log('Connected wallet:', wallet.name, wallet.account?.address);
    }
    if (activeFilter === 'collections') {
      setFilteredData([]);
      setSelectedCollection(null);
    } else if (activeFilter === 'auctions' && listingsData?.sui.listings) {
      setFilteredData(listingsData.sui.listings);
    }
  }, [listingsData, wallet.connected, wallet.error, activeFilter]);

  const handleSearch = (query) => {
    setActiveFilter('search');
    setSelectedCollection(null);
    if (!query) {
      setFilteredData(listingsData?.sui.listings || []);
      alert('Displaying all NFTs.');
      return;
    }
    const filtered = listingsData?.sui.listings.filter(
      (nft) =>
        (nft.nft.name && nft.nft.name.toLowerCase().includes(query.toLowerCase())) ||
        Object.values(nft.nft.chain_state.bcs).some(
          (value) => value && typeof value === 'string' && value.toLowerCase().includes(query.toLowerCase())
        )
    ) || [];
    setFilteredData(filtered);
    alert(`Found ${filtered.length} NFTs matching "${query}"`);
  };

  const handleMyNfts = () => {
    setActiveFilter('my-nfts');
    setSelectedCollection(null);
    if (!wallet.connected) {
      alert('Please connect your wallet to view your NFTs.');
      setFilteredData([]);
      return;
    }
    if (walletNftsLoading) {
      setFilteredData([]);
      alert('Loading your NFTs...');
      return;
    }
    if (walletNftsError) {
      setFilteredData([]);
      alert(`Error loading NFTs: ${walletNftsError.message}`);
      return;
    }
    const nfts = walletNftsData?.sui.nfts || [];
    setFilteredData(nfts.map((nft) => ({ nft, price: '0' })));
    if (nfts.length === 0) {
      alert("You don't own any NFTs yet.");
    }
  };

  const handleAuctions = () => {
    setActiveFilter('auctions');
    setSelectedCollection(null);
    setFilteredData([]);
  };

  const handleCollections = () => {
    setActiveFilter('collections');
    setSelectedCollection(null);
    setFilteredData([]);
  };

  const handleApply = () => {
    setActiveFilter('apply');
    setSelectedCollection(null);
    setFilteredData([]);
  };

  const handleAdmin = () => {
    if (!isAdmin) {
      alert('You do not have admin access.');
      return;
    }
    setActiveFilter('admin');
    setSelectedCollection(null);
    setFilteredData([]);
  };

  const toggleDrawer = () => {
    setDrawerOpen(!drawerOpen);
  };

  const navItems = [
    { label: 'Live Auction', onClick: handleAuctions, to: '/' },
    { label: 'Collections', onClick: handleCollections, to: '/collections' },
    { label: 'My NFTs', onClick: handleMyNfts, to: '/my-nfts' },
    // { label: 'Admin', onClick: handleAdmin, to: '/admin' },
  ];

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Router>
        <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
          <AppBar position="sticky">
            <Toolbar sx={{ minHeight: { xs: 48, md: 56 } }}>
              <IconButton
                color="primary"
                edge="start"
                onClick={toggleDrawer}
                sx={{ mr: 1, display: { md: 'none' } }}
              >
                <MenuIcon />
              </IconButton>
              <Typography
                variant="h6"
                sx={{
                  flexGrow: 1,
                  fontWeight: 700,
                  fontSize: { xs: '1.2rem', md: '1.5rem' },
                  color: 'primary.main',
                  textAlign: { xs: 'left', md: 'left' },
                }}
              >
                Lofita Auction
              </Typography>
              {isMobile ? (
                <ConnectButton />
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, md: 1.5 } }}>
                  {navItems.map((item) => (
                    <Button
                      key={item.label}
                      color="inherit"
                      component={Link}
                      to={item.to}
                      onClick={item.onClick}
                      sx={{
                        fontSize: { xs: '0.8rem', md: '0.9rem' },
                        color: 'text.primary',
                        '&:hover': { color: 'primary.main', bgcolor: 'rgba(255,0,122,0.1)' },
                        px: { xs: 1, md: 1.5 },
                      }}
                    >
                      {item.label}
                    </Button>
                  ))}
                  <ConnectButton />
                </Box>
              )}
            </Toolbar>
          </AppBar>
          <Drawer
            anchor="left"
            open={drawerOpen}
            onClose={toggleDrawer}
            sx={{
              display: { md: 'none' },
              '& .MuiDrawer-paper': {
                width: 280,
                bgcolor: 'background.paper',
                borderRight: '1px solid rgba(255, 255, 255, 0.12)',
              },
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* Drawer Header */}
              <Box
                sx={{
                  p: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
                }}
              >
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 700,
                    color: 'primary.main',
                  }}
                >
                  Lofita Auction
                </Typography>
                <IconButton onClick={toggleDrawer} sx={{ color: 'text.secondary' }}>
                  <MenuIcon />
                </IconButton>
              </Box>

              {/* Navigation Items */}
              <List sx={{ flexGrow: 1, p: 1 }}>
                {navItems.map((item) => (
                  <ListItem
                    key={item.label}
                    component={Link}
                    to={item.to}
                    onClick={() => {
                      item.onClick();
                      toggleDrawer();
                    }}
                    sx={{
                      borderRadius: 1,
                      mb: 0.5,
                      color: 'text.primary',
                      py: 1.5,
                      px: 2,
                      '&:hover': {
                        bgcolor: 'rgba(255, 0, 122, 0.1)',
                        color: 'primary.main',
                      },
                      '&.Mui-selected': {
                        bgcolor: 'rgba(255, 0, 122, 0.2)',
                        color: 'primary.main',
                        '&:hover': {
                          bgcolor: 'rgba(255, 0, 122, 0.3)',
                        },
                      },
                    }}
                    selected={activeFilter === item.label.toLowerCase().replace(' ', '-')}
                  >
                    <ListItemText
                      primary={item.label}
                      primaryTypographyProps={{
                        fontSize: '1rem',
                        fontWeight: 500,
                      }}
                    />
                  </ListItem>
                ))}
              </List>

              {/* Footer Section */}
              <Box
                sx={{
                  p: 2,
                  borderTop: '1px solid rgba(255, 255, 255, 0.12)',
                  bgcolor: 'background.default',
                }}
              >
                <Typography
                  variant="caption"
                  sx={{ color: 'text.secondary', display: 'block', textAlign: 'center' }}
                >
                  © 2025 Lofita Auction
                </Typography>
              </Box>
            </Box>
          </Drawer>

          <Container sx={{ py: { xs: 2, md: 3 }, maxWidth: 'lg' }}>
            <Routes>
              <Route
                path="/"
                element={
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 2, md: 3 } }}>
                    {listingsLoading && (
                      <Alert severity="info" sx={{ maxWidth: 500, mx: 'auto', bgcolor: 'background.paper' }}>
                        Loading auction data...
                      </Alert>
                    )}
                    {listingsError && (
                      <Alert severity="error" sx={{ maxWidth: 500, mx: 'auto', bgcolor: 'background.paper' }}>
                        Error loading auction: {listingsError.message}. Please try refreshing.
                      </Alert>
                    )}
                    <Box>
                      <Typography
                        variant="h5"
                        sx={{
                          fontWeight: 700,
                          color: 'primary.main',
                          mb: 2,
                          textAlign: 'center',
                        }}
                      >
                        Live Auction
                      </Typography>
                      <LiveAuction />
                    </Box>
                  </Box>
                }
              />
              <Route
                path="/collections"
                element={
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 2, md: 3 } }}>
                    {(yetisLoading || dooniesLoading) && (
                      <Alert severity="info" sx={{ maxWidth: 500, mx: 'auto', bgcolor: 'background.paper' }}>
                        Loading collections...
                      </Alert>
                    )}
                    {(yetisError || dooniesError) && (
                      <Alert severity="error" sx={{ maxWidth: 500, mx: 'auto', bgcolor: 'background.paper' }}>
                        Error loading collections: {(yetisError?.message || dooniesError?.message)}. Please try refreshing.
                      </Alert>
                    )}
                    <Box>
                      <Typography
                        variant="h5"
                        sx={{
                          fontWeight: 700,
                          color: 'primary.main',
                          mb: 2,
                          textAlign: 'center',
                        }}
                      >
                        Collections
                      </Typography>
                      <CollectionGrid
                        collections={collections}
                        onSelectCollection={(collection) => setSelectedCollection(collection)}
                      />
                    </Box>
                  </Box>
                }
              />
              <Route
                path="/collection/:slug"
                element={<CollectionNFTs collections={collections} />}
              />
              <Route path="/my-nfts" element={<MyNFTGrid nfts={filteredData} />} />
              <Route path="/apply" element={<ApplyForm />} />
              <Route path="/admin" element={isAdmin ? <AdminView /> : <Alert severity="error" sx={{ maxWidth: 500, mx: 'auto', bgcolor: 'background.paper' }}>You do not have admin access.</Alert>} />
              <Route path="/nft/:collectionId/:tokenId" element={<NFTDetail />} />
            </Routes>
          </Container>
        </Box>
      </Router>
    </ThemeProvider>
  );
}

// New Component for Collection NFTs
function CollectionNFTs({ collections }) {
  const { slug } = useParams();
  const navigate = useNavigate();
  const collection = collections.find((c) => c.slug === slug);
  const { loading, error, data } = useQuery(FETCH_LISTINGS, {
    variables: { collectionId: collection?.id || '' },
    skip: !collection || collection.slug === 'bored-toilet-club',
  });

  if (!collection) {
    return <Alert severity="error" sx={{ bgcolor: 'background.paper' }}>Collection not found.</Alert>;
  }

  if (collection.slug === 'bored-toilet-club') {
    return <Alert severity="info" sx={{ bgcolor: 'background.paper' }}>Bored Toilet Club NFTs are coming soon.</Alert>;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {loading && <Alert severity="info" sx={{ bgcolor: 'background.paper' }}>Loading NFTs...</Alert>}
      {error && <Alert severity="error" sx={{ bgcolor: 'background.paper' }}>Error loading NFTs: {error.message}</Alert>}
      <Typography variant="h5" sx={{ fontWeight: 700, color: 'primary.main', mb: 2, textAlign: 'center' }}>
        {collection.title} NFTs
      </Typography>
      <MyNFTGrid nfts={data?.sui.listings || []} />
    </Box>
  );
}

export default App;