import { useState, useEffect } from 'react';
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

interface ProviderConfig {
  provider: string;
  model: string;
  hasMistralKey: boolean;
}

interface Model {
  id: string;
  name: string;
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [mistralKey, setMistralKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProviderConfig();
  }, []);

  const fetchProviderConfig = async () => {
    try {
      const res = await fetch('/api/providers/config');
      const data = await res.json();
      setConfig(data);
      if (data.hasMistralKey) {
        fetchModels(data.provider);
      }
    } catch (err) {
      console.error('Failed to fetch provider config:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchModels = async (provider: string) => {
    try {
      const res = await fetch(`/api/providers/models?provider=${provider}`);
      const data = await res.json();
      setModels(data.models || []);
    } catch (err) {
      console.error('Failed to fetch models:', err);
    }
  };

  const handleProviderChange = async (provider: string) => {
    setSaving(true);
    setError(null);
    try {
      await fetch('/api/providers/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      setConfig((prev) => (prev ? { ...prev, provider } : null));
      if (provider === 'mistral') {
        fetchModels(provider);
      }
    } catch (err) {
      setError('Failed to update provider');
    } finally {
      setSaving(false);
    }
  };

  const handleModelChange = async (model: string) => {
    setSaving(true);
    setError(null);
    try {
      await fetch('/api/providers/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      setConfig((prev) => (prev ? { ...prev, model } : null));
    } catch (err) {
      setError('Failed to update model');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveMistralKey = async () => {
    if (!mistralKey.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await fetch('/api/providers/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKeys: { mistral: mistralKey } }),
      });
      fetchProviderConfig();
    } catch (err) {
      setError('Failed to save API key');
    } finally {
      setSaving(false);
    }
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

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
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
              value={config?.provider || 'qwen'}
              label="Provider"
              onChange={(e) => handleProviderChange(e.target.value)}
              disabled={saving}
            >
              <MenuItem value="qwen">Qwen (OAuth - Free)</MenuItem>
              <MenuItem value="mistral">Mistral (API Key)</MenuItem>
            </Select>
          </FormControl>

          {config?.provider === 'mistral' && (
            <>
              <TextField
                label="Mistral API Key"
                type="password"
                value={mistralKey || (config?.hasMistralKey ? '••••••••' : '')}
                onChange={(e) => setMistralKey(e.target.value)}
                placeholder="sk-..."
                fullWidth
                helperText={
                  config.hasMistralKey
                    ? 'API key is configured'
                    : 'Enter your Mistral API key'
                }
              />
              <Button
                variant="contained"
                onClick={handleSaveMistralKey}
                disabled={saving || !mistralKey.trim()}
              >
                {saving ? 'Saving...' : 'Save API Key'}
              </Button>

              {models.length > 0 && (
                <FormControl fullWidth>
                  <InputLabel>Model</InputLabel>
                  <Select
                    value={config?.model || ''}
                    label="Model"
                    onChange={(e) => handleModelChange(e.target.value)}
                    disabled={saving}
                  >
                    {models.map((model) => (
                      <MenuItem key={model.id} value={model.id}>
                        {model.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
            </>
          )}

          {config?.provider === 'qwen' && (
            <Alert severity="info">
              Qwen uses OAuth authentication. The free tier includes 1,000
              requests/day. Quota resets at 00:00 Beijing Time (4:00 PM PST).
            </Alert>
          )}
        </Box>
      </Paper>
    </Box>
  );
}
