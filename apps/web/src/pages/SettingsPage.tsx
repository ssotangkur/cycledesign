import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
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

const API_KEY_PLACEHOLDER = '**********';

export default function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyTouched, setApiKeyTouched] = useState(false);

  const { data: providersData, isLoading: loadingProviders } = trpc.providerConfig.list.useQuery();
  const { data: configData, isLoading: loadingConfig } = trpc.providerConfig.getConfig.useQuery();
  
  // Fetch models based on current provider - refetches when provider changes
  const { data: modelsData, isLoading: loadingModels, error: modelsError, refetch: refetchModels } = trpc.providerConfig.listModels.useQuery(undefined, {
    enabled: !!configData?.provider,
  });

  const updateConfigMutation = trpc.providerConfig.updateConfig.useMutation({
    onSuccess: () => {
      // Invalidate config and models queries to refetch with updated data
      queryClient.invalidateQueries({
        queryKey: [['providerConfig', 'getConfig']],
      });
      queryClient.invalidateQueries({
        queryKey: [['providerConfig', 'listModels']],
      });
      setApiKeyInput(API_KEY_PLACEHOLDER);
    },
  });

  const loading = loadingProviders || loadingConfig;
  const saving = updateConfigMutation.isPending;

  const currentProvider = providersData?.find((p) => p.name === configData?.provider);

  const showPlaceholder = configData?.hasApiKey && !apiKeyTouched;
  const apiKeyDisplayValue = loadingConfig
    ? ''
    : showPlaceholder
      ? API_KEY_PLACEHOLDER
      : apiKeyInput;

  const handleProviderChange = (provider: string) => {
    // Update provider - this will trigger the models query to refetch via the enabled flag
    updateConfigMutation.mutate({ provider });
  };

  const handleModelChange = (model: string) => {
    updateConfigMutation.mutate({ model });
  };

  const handleApiKeyChange = (value: string) => {
    if (!apiKeyTouched) {
      setApiKeyTouched(true);
    }
    setApiKeyInput(value.startsWith(API_KEY_PLACEHOLDER) ? '' : value);
  };

  const handleSaveApiKey = () => {
    if (!apiKeyInput.trim() || apiKeyInput === API_KEY_PLACEHOLDER) return;
    updateConfigMutation.mutate({
      apiKey: apiKeyInput.trim(),
    });
  };

  const handleRetryModels = () => {
    refetchModels();
  };

  // Reset model selection when provider changes (model IDs are provider-specific)
  const previousProviderRef = useRef(configData?.provider);
  useEffect(() => {
    if (modelsData && modelsData.length > 0 && configData?.model) {
      // Check if current model is valid for the new provider
      const isValidModel = modelsData.some((m) => m.id === configData.model);
      if (!isValidModel && previousProviderRef.current !== configData?.provider) {
        // Reset to first available model only if provider actually changed
        previousProviderRef.current = configData?.provider;
        updateConfigMutation.mutate({ model: modelsData[0].id });
      } else if (previousProviderRef.current === configData?.provider) {
        // Update ref if model was just reset
        previousProviderRef.current = configData?.provider;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsData, configData?.model, configData?.provider]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box data-testid="settings-page" sx={{ maxWidth: 800, margin: '0 auto' }}>
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
              data-testid="provider-select"
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

          <FormControl fullWidth error={!!modelsError}>
            <InputLabel>Model</InputLabel>
            <Select
              value={
                modelsData?.some((m) => m.id === configData?.model)
                  ? configData?.model
                  : modelsData?.[0]?.id || ''
              }
              label="Model"
              onChange={(e) => handleModelChange(e.target.value)}
              disabled={saving || loadingModels}
              data-testid="model-select"
            >
              {loadingModels ? (
                <MenuItem value="" disabled>
                  Loading models...
                </MenuItem>
              ) : modelsError ? (
                <MenuItem value="" disabled>
                  Failed to load models
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
          
          {/* Error state with retry option */}
          {modelsError && (
            <Alert severity="error" action={
              <Button color="inherit" size="small" onClick={handleRetryModels}>
                Retry
              </Button>
            }>
              Failed to load models. Please try again.
            </Alert>
          )}
        </Box>
      </Paper>
    </Box>
  );
}
