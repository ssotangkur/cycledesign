import { Router } from 'express';
import { previewManager } from '../preview/preview-manager';

export const previewRouter = Router();

previewRouter.post('/start', async (req, res): Promise<void> => {
  console.log('[API] POST /api/preview/start called, designName:', req.body?.designName);
  try {
    const { designName } = req.body || {};
    console.log('[PREVIEW] Starting preview server for design:', designName);
    await previewManager.start({ designName });
    
    const status = previewManager.getStatus();
    console.log('[PREVIEW] Preview server started successfully on port:', status.port);
    res.status(200).json({
      success: true,
      port: status.port,
      url: status.url,
      status: status.status,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to start preview server';
    console.error('[PREVIEW] Failed to start preview server:', errorMessage);
    res.status(500).json({
      success: false,
      status: 'ERROR',
      error: errorMessage,
    });
  }
});

previewRouter.post('/stop', async (_req, res): Promise<void> => {
  console.log('[API] POST /api/preview/stop called');
  try {
    console.log('[PREVIEW] Stopping preview server');
    await previewManager.stop();
    console.log('[PREVIEW] Preview server stopped successfully');
    res.status(200).json({
      success: true,
      message: 'Preview server stopped successfully',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to stop preview server';
    console.error('[PREVIEW] Failed to stop preview server:', errorMessage);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

previewRouter.get('/status', async (_req, res): Promise<void> => {
  console.log('[API] GET /api/preview/status called');
  try {
    const status = previewManager.getStatus();
    console.log('[PREVIEW] Status:', status.status, 'port:', status.port);
    res.status(200).json(status);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to get preview status';
    console.error('[PREVIEW] Failed to get status:', errorMessage);
    res.status(500).json({
      error: errorMessage,
    });
  }
});

previewRouter.post('/restart', async (req, res): Promise<void> => {
  console.log('[API] POST /api/preview/restart called, designName:', req.body?.designName);
  try {
    const { designName } = req.body || {};
    console.log('[PREVIEW] Restarting preview server for design:', designName);
    await previewManager.restart({ designName });
    
    const status = previewManager.getStatus();
    console.log('[PREVIEW] Preview server restarted successfully on port:', status.port);
    res.status(200).json({
      success: true,
      port: status.port,
      url: status.url,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to restart preview server';
    console.error('[PREVIEW] Failed to restart preview server:', errorMessage);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});
