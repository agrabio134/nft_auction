import React from 'react';
import {
  Card,
  CardMedia,
  CardContent,
  Typography,
  Button,
  Box,
  Chip,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';

function AuctionCard({ id, title, image, currentBid, endTime }) {
  const navigate = useNavigate();
  const timeLeft = new Date(endTime).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Card
      sx={{
        maxWidth: 345,
        transition: 'transform 0.3s',
        '&:hover': { transform: 'scale(1.03)' },
      }}
    >
      <CardMedia
        component="img"
        height="200"
        image={image}
        alt={title}
        sx={{ objectFit: 'cover' }}
      />
      <CardContent>
        <Typography variant="h2" gutterBottom>
          {title}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Current Bid: {currentBid} SUI
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', mt: 1, mb: 2 }}>
          <Chip
            label={`Ends: ${timeLeft}`}
            color="error"
            size="small"
            sx={{ mr: 1 }}
          />
        </Box>
        <Button
          variant="contained"
          color="primary"
          fullWidth
          onClick={() => navigate(`/auction/${id}`)}
          aria-label={`Place bid on ${title}`}
        >
          Place Bid
        </Button>
      </CardContent>
    </Card>
  );
}

export default AuctionCard;