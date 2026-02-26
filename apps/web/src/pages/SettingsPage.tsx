import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Button,
  Alert,
  CircularProgress,
  IconButton,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { trpc } from '../utils/trpc';

// Placeholder value shown when API key is configured (displays as dots in password field)
const API_KEY_PLACEHOLDER = '**********';

export default function SettingsPage() {
  const navigate = useNavigate();
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyTouched, setApiKeyTouched] = useState(false);

  // tRPC queries
  const { data: providersData, isLoading: loadingProviders } = trpc.providers.list.useQuery();
  const { data: configData, isLoading: loadingConfig, refetch: refetchConfig } = trpc.providers.getConfig.useQuery();
  const { data: modelsData, isLoading: loadingModels } = trpc.providers.listModels.useQuery(undefined, {
    enabled: !!configData?.hasApiKey,
  });

  // tRPC mutations
  const updateConfigMutation = trpc.providers.updateConfig.useMutation({
    onSuccess: () => {
      refetchConfig();
      setApiKeyInput(API_KEY_PLACEHOLDER);
    },
  });

  const loading = loadingProviders || loadingConfig;
  const saving = updateConfigMutation.isPending;

  const currentProvider = providersData?.find((p) => p.name === configData?.provider);

  // Compute the display value for API key field
  const showPlaceholder = configData?.hasApiKey && !apiKeyTouched;
  const apiKeyDisplayValue = loadingConfig
    ? ''
    : showPlaceholder
      ? API_KEY_PLACEHOLDER
      : apiKeyInput;

  const handleProviderChange = (provider: string) => {
    updateConfigMutation.mutate({ provider });
  };

  const handleModelChange = (model: string) => {
    updateConfigMutation.mutate({ model });
  };

  const handleApiKeyChange = (value: string) => {
    // Mark as touched when user starts typing
    if (!apiKeyTouched) {
      setApiKeyTouched(true);
    }
    // If value starts with placeholder (user typed into it), clear it
    setApiKeyInput(value.startsWith(API_KEY_PLACEHOLDER) ? '' : value);
  };

  const handleSaveApiKey = () => {
    if (!apiKeyInput.trim() || apiKeyInput === API_KEY_PLACEHOLDER) return;
    updateConfigMutation.mutate({
      apiKey: apiKeyInput.trim(),
    });
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 800, margin: '0 auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <IconButton onClick={() => navigate('/')} sx={{ mr: 1 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h4">
          Settings
        </Typography>
      </Box>

      {updateConfigMutation.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {updateConfigMutation.error.message}
        </Alert>
      )}

      <Paper sx={{ p: 3, mb: 2 }}>
        <Typography variant="h6" gutterBottom>
          AI Provider
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <FormControl fullWidth>
            <InputLabel>Provider</InputLabel>
            <Select
              value={configData?.provider || ''}
              label="Provider"
              onChange={(e) => handleProviderChange(e.target.value)}
              disabled={saving}
            >
              {providersData?.map((p) => (
                <MenuItem key={p.name} value={p.name}>
                  {p.displayName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {currentProvider?.requiresApiKey && (
            <>
              <TextField
                label="API Key"
                type="password"
                value={apiKeyDisplayValue}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                placeholder={configData?.hasApiKey
                  ? 'API key is configured. Enter new key to update.'
                  : `Enter your ${currentProvider.displayName} API key`}
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
              <Button
                variant="contained"
                onClick={handleSaveApiKey}
                disabled={saving || !apiKeyInput.trim() || apiKeyInput === API_KEY_PLACEHOLDER}
              >
                {saving ? 'Saving...' : 'Save API Key'}
              </Button>
            </>
          )}

          <FormControl fullWidth>
            <InputLabel>Model</InputLabel>
            <Select
              value={
                // Ensure value is valid - use first model if saved model not in list
                modelsData?.some((m) => m.id === configData?.model)
                  ? configData?.model
                  : modelsData?.[0]?.id || ''
              }
              label="Model"
              onChange={(e) => handleModelChange(e.target.value)}
              disabled={saving || loadingModels}
            >
              {loadingModels ? (
                <MenuItem value="" disabled>
                  Loading models...
                </MenuItem>
              ) : !modelsData || modelsData.length === 0 ? (
                <MenuItem value="" disabled>
                  {configData?.hasApiKey ? 'No models available' : 'Provide API key to see models'}
                </MenuItem>
              ) : (
                modelsData.map((model) => (
                  <MenuItem key={model.id} value={model.id}>
                    {model.name}
                  </MenuItem>
                ))
              )}
            </Select>
          </FormControl>
        </Box>
      </Paper>
    </Box>
  );
}
