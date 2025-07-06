import React, { useState } from 'react';
import { TextField, Button, InputAdornment, Box } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';

function SearchBar({ onSearch }) {
  const [query, setQuery] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmedQuery = query.trim();
    onSearch(trimmedQuery);
    if (!trimmedQuery) setQuery('');
  };

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center', // Center the search bar
        width: '100%',
        maxWidth: { xs: 300, sm: 400 }, // Compact width, responsive
        mx: 'auto', // Center horizontally
      }}
    >
      <form onSubmit={handleSubmit} style={{ width: '100%' }}>
        <TextField
          fullWidth
          variant="outlined"
          placeholder="Search NFTs..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          size="small" // Compact input
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: 'text.secondary' }} />
              </InputAdornment>
            ),
            endAdornment: (
              <InputAdornment position="end">
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  size="small"
                  sx={{
                    textTransform: 'none',
                    borderRadius: '0 4px 4px 0',
                    px: 1.5,
                    py: 0.5,
                    fontSize: '0.8rem',
                  }}
                  aria-label="Search NFTs"
                >
                  Search
                </Button>
              </InputAdornment>
            ),
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: 6,
              backgroundColor: 'background.paper',
              fontSize: '0.8rem',
            },
          }}
        />
      </form>
    </Box>
  );
}

export default SearchBar;