import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    primary: {
      main: '#F06292', // Soft, professional pink for primary actions
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#FFCDD2', // Very subtle, light pink for minimal accents
      contrastText: '#212121', // Dark text for contrast
    },
    background: {
      default: '#2E2E2E', // Soft dark gray background
      paper: '#363636', // Slightly lighter gray for cards/surfaces
    },
    text: {
      primary: '#E0E0E0', // Light gray for primary text
      secondary: '#B0B0B0', // Medium gray for secondary text
    },
    divider: '#4A4A4A', // Light divider for visibility
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h1: {
      fontSize: '2.25rem',
      fontWeight: 600,
      color: '#E0E0E0',
    },
    h2: {
      fontSize: '1.75rem',
      fontWeight: 500,
      color: '#E0E0E0',
    },
    body1: {
      fontSize: '1rem',
      color: '#E0E0E0',
    },
    body2: {
      fontSize: '0.875rem',
      color: '#B0B0B0',
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          textTransform: 'none',
          padding: '8px 16px',
          '&:hover': {
            backgroundColor: '#4A4A4A', // Neutral gray hover for non-contained buttons
          },
        },
        containedPrimary: {
          backgroundColor: '#F06292', // Soft pink for primary buttons
          '&:hover': {
            backgroundColor: '#D81B60', // Slightly darker pink on hover
          },
        },
        containedSecondary: {
          backgroundColor: '#FFCDD2', // Subtle pink for secondary buttons
          '&:hover': {
            backgroundColor: '#F8BBD0', // Slightly darker subtle pink on hover
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)', // Softer shadow
          backgroundColor: '#363636',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#262626', // Darker app bar
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            backgroundColor: '#363636',
            color: '#E0E0E0',
            '& fieldset': {
              borderColor: '#4A4A4A',
            },
            '&:hover fieldset': {
              borderColor: '#FFCDD2', // Subtle pink on hover
            },
            '&.Mui-focused fieldset': {
              borderColor: '#F06292', // Soft pink when focused
            },
          },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          backgroundColor: '#363636',
          color: '#E0E0E0',
        },
        standardInfo: {
          backgroundColor: '#424242',
          color: '#F8BBD0', // Light pink for info alerts, matching secondary
        },
        standardError: {
          backgroundColor: '#424242',
          color: '#EF9A9A', // Soft red for error alerts
        },
      },
    },
  },
  transitions: {
    duration: {
      standard: 300,
    },
  },
});

export default theme;