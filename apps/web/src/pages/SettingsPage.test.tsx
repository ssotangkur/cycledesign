import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { listUseQuery, getConfigUseQuery, listModelsUseQuery, updateConfigUseMutation } =
  vi.hoisted(() => ({
    listUseQuery: vi.fn(),
    getConfigUseQuery: vi.fn(),
    listModelsUseQuery: vi.fn(),
    updateConfigUseMutation: vi.fn(),
  }));

vi.mock('../utils/trpc', () => ({
  trpc: {
    providerConfig: {
      list: { useQuery: listUseQuery },
      getConfig: { useQuery: getConfigUseQuery },
      updateConfig: { useMutation: updateConfigUseMutation },
      listModels: { useQuery: listModelsUseQuery },
    },
  },
}));

import SettingsPage from './SettingsPage';

type Provider = { name: string; displayName: string; requiresApiKey: boolean };
type Model = { id: string; name: string };
type Config = { provider?: string; model?: string; hasApiKey?: boolean };

type Scenario = {
  providers: Provider[];
  config: Config;
  models: Model[];
  modelsError?: Error | null;
  loadingProviders?: boolean;
  loadingConfig?: boolean;
  loadingModels?: boolean;
  mutation?: {
    mutate: ReturnType<typeof vi.fn>;
    isPending?: boolean;
    error?: Error | null;
  };
  modelsRefetch?: ReturnType<typeof vi.fn>;
};

const PROVIDER_A: Provider = {
  name: 'provider-a',
  displayName: 'Provider A',
  requiresApiKey: true,
};
const PROVIDER_B: Provider = {
  name: 'provider-b',
  displayName: 'Provider B',
  requiresApiKey: false,
};
const PROVIDER_C: Provider = {
  name: 'provider-c',
  displayName: 'Provider C',
  requiresApiKey: true,
};

const MODEL_A1: Model = { id: 'model-a-1', name: 'Model A-1' };
const MODEL_A2: Model = { id: 'model-a-2', name: 'Model A-2' };
const MODEL_B3: Model = { id: 'model-b-3', name: 'Model B-3' };
const MODEL_B4: Model = { id: 'model-b-4', name: 'Model B-4' };
const MODEL_B5: Model = { id: 'model-b-5', name: 'Model B-5' };

function defaultScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    providers: [PROVIDER_A, PROVIDER_B, PROVIDER_C],
    config: { provider: PROVIDER_A.name, model: MODEL_A1.id, hasApiKey: true },
    models: [MODEL_A1, MODEL_A2],
    loadingProviders: false,
    loadingConfig: false,
    loadingModels: false,
    modelsError: null,
    modelsRefetch: vi.fn(),
    mutation: {
      mutate: vi.fn(),
      isPending: false,
      error: null,
    },
    ...overrides,
  };
}

function applyScenario(scenario: Scenario) {
  const mutate = scenario.mutation?.mutate ?? vi.fn();
  const mutationImpl = {
    mutate,
    isPending: scenario.mutation?.isPending ?? false,
    error: scenario.mutation?.error ?? null,
  };

  listUseQuery.mockImplementation(() => ({
    data: scenario.providers,
    isLoading: scenario.loadingProviders ?? false,
    error: null,
    refetch: vi.fn(),
  }));
  getConfigUseQuery.mockImplementation(() => ({
    data: scenario.config,
    isLoading: scenario.loadingConfig ?? false,
    error: null,
    refetch: vi.fn(),
  }));
  listModelsUseQuery.mockImplementation(() => ({
    data: scenario.models,
    isLoading: scenario.loadingModels ?? false,
    error: scenario.modelsError ?? null,
    refetch: scenario.modelsRefetch ?? vi.fn(),
  }));
  updateConfigUseMutation.mockImplementation(() => mutationImpl);

  return { mutate };
}

function renderSettingsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listUseQuery.mockReset();
  getConfigUseQuery.mockReset();
  listModelsUseQuery.mockReset();
  updateConfigUseMutation.mockReset();
});

function openSelect(testId: string) {
  const selectRoot = screen.getByTestId(testId);
  const trigger = within(selectRoot).getByRole('combobox');
  fireEvent.mouseDown(trigger);
  return trigger;
}

function openProviderSelect() {
  return openSelect('provider-select');
}

function openModelSelect() {
  return openSelect('model-select');
}

describe('SettingsPage', () => {
  it('renders the page for the configured provider', () => {
    const { mutate } = applyScenario(defaultScenario());
    renderSettingsPage();
    expect(screen.getByTestId('settings-page')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'AI Provider' })).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('calls mutate with the new provider when the provider selection changes', () => {
    const { mutate } = applyScenario(defaultScenario());
    renderSettingsPage();

    openProviderSelect();
    const listbox = screen.getByRole('listbox');
    fireEvent.click(within(listbox).getByText('Provider B'));

    expect(mutate).toHaveBeenCalledWith({ provider: PROVIDER_B.name });
  });

  it('resets the model selection when switching to a provider with different model IDs', () => {
    const { mutate: mutateA } = applyScenario(defaultScenario());

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const renderResult = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Sanity: provider A renders with model A-1 selected, no auto-mutation yet
    expect(mutateA).not.toHaveBeenCalled();

    // Phase 2: rerender with provider B (model "a-1" no longer valid) and B's models
    const { mutate: mutateB } = applyScenario({
      ...defaultScenario(),
      config: { provider: PROVIDER_B.name, model: MODEL_A1.id, hasApiKey: false },
      models: [MODEL_B3, MODEL_B4, MODEL_B5],
    });

    renderResult.rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(mutateB).toHaveBeenCalledWith({ model: MODEL_B3.id });
  });

  it('shows an Alert with retry button when model loading fails, and refetches on retry', () => {
    const refetch = vi.fn();
    applyScenario(
      defaultScenario({
        modelsError: new Error('boom'),
        models: [],
        modelsRefetch: refetch,
      }),
    );

    renderSettingsPage();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Failed to load models');
    const retryButton = within(alert).getByRole('button', { name: /retry/i });
    fireEvent.click(retryButton);
    expect(refetch).toHaveBeenCalled();

    openModelSelect();
    expect(screen.getByRole('option', { name: 'Failed to load models' })).toBeTruthy();
  });

  it('renders the API key field when the current provider requires one (with hasApiKey=true placeholder)', () => {
    applyScenario(
      defaultScenario({
        config: { provider: PROVIDER_A.name, model: MODEL_A1.id, hasApiKey: true },
      }),
    );
    renderSettingsPage();

    const apiKeyField = screen.getByLabelText('API Key');
    expect(apiKeyField).toBeTruthy();
    expect(apiKeyField.getAttribute('placeholder')).toBe(
      'API key is configured. Enter new key to update.',
    );
  });

  it('renders the API key field with the provider-specific placeholder when hasApiKey=false', () => {
    applyScenario(
      defaultScenario({
        config: { provider: PROVIDER_A.name, model: MODEL_A1.id, hasApiKey: false },
      }),
    );
    renderSettingsPage();

    const apiKeyField = screen.getByLabelText('API Key');
    expect(apiKeyField).toBeTruthy();
    expect(apiKeyField.getAttribute('placeholder')).toBe(
      `Enter your ${PROVIDER_A.displayName} API key`,
    );
  });

  it('does not render the API key field when the current provider does not require one', () => {
    applyScenario(
      defaultScenario({
        config: { provider: PROVIDER_B.name, model: MODEL_B3.id, hasApiKey: false },
      }),
    );
    renderSettingsPage();

    expect(screen.queryByLabelText('API Key')).toBeNull();
  });

  it('shows a CircularProgress while providers are loading', () => {
    applyScenario(defaultScenario({ loadingProviders: true }));
    const { container } = renderSettingsPage();
    expect(container.querySelector('.MuiCircularProgress-root')).toBeTruthy();
    expect(screen.queryByTestId('settings-page')).toBeNull();
  });

  it('shows a CircularProgress while config is loading', () => {
    applyScenario(defaultScenario({ loadingConfig: true }));
    const { container } = renderSettingsPage();
    expect(container.querySelector('.MuiCircularProgress-root')).toBeTruthy();
  });

  it('disables the Model select while models are loading', () => {
    applyScenario(defaultScenario({ loadingModels: true }));
    renderSettingsPage();

    // The Model Select is disabled while loading; the "Loading models..."
    // placeholder is rendered as a MenuItem inside the closed Select.
    const modelCombobox = within(screen.getByTestId('model-select')).getByRole(
      'combobox',
    );
    expect(modelCombobox.getAttribute('aria-disabled')).toBe('true');
  });

  it('disables the selects and shows Saving... while the mutation is pending', () => {
    applyScenario(
      defaultScenario({
        mutation: { mutate: vi.fn(), isPending: true, error: null },
      }),
    );
    renderSettingsPage();

    const providerCombobox = within(screen.getByTestId('provider-select')).getByRole(
      'combobox',
    );
    const modelCombobox = within(screen.getByTestId('model-select')).getByRole(
      'combobox',
    );
    expect(providerCombobox.getAttribute('aria-disabled')).toBe('true');
    expect(modelCombobox.getAttribute('aria-disabled')).toBe('true');

    expect(screen.getByRole('button', { name: /saving/i })).toBeTruthy();
  });

  it('renders an error Alert with the mutation error message', () => {
    applyScenario(
      defaultScenario({
        mutation: {
          mutate: vi.fn(),
          isPending: false,
          error: new Error('Save failed'),
        },
      }),
    );
    renderSettingsPage();

    const alerts = screen.getAllByRole('alert');
    const errorAlert = alerts.find((el) => el.textContent?.includes('Save failed'));
    expect(errorAlert).toBeTruthy();
  });

  it('shows "No models available" for empty models when hasApiKey=true', () => {
    applyScenario(
      defaultScenario({
        config: { provider: PROVIDER_C.name, model: undefined, hasApiKey: true },
        models: [],
      }),
    );
    renderSettingsPage();

    openModelSelect();
    expect(screen.getByRole('option', { name: 'No models available' })).toBeTruthy();
  });

  it('shows "Provide API key to see models" for empty models when hasApiKey=false', () => {
    applyScenario(
      defaultScenario({
        config: { provider: PROVIDER_C.name, model: undefined, hasApiKey: false },
        models: [],
      }),
    );
    renderSettingsPage();

    openModelSelect();
    expect(
      screen.getByRole('option', { name: 'Provide API key to see models' }),
    ).toBeTruthy();
  });
});