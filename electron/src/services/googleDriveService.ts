import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Database } from 'better-sqlite3';
import { getDatabasePath } from '../db';
import { inventoryService, settingsService } from './dataService';

const GOOGLE_DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const GOOGLE_DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const GOOGLE_DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3/files';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const GOOGLE_SCOPE =
  'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email openid';

const STOCKS_FILE_NAME = 'localbiz-stocks.json';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const setSetting = (db: Database, key: string, value: string) => {
  db.prepare(
    `INSERT INTO settings (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
};

const getGoogleConfig = (db: Database) => {
  const settings = settingsService.getAll(db);
  return {
    clientId: (settings.gdrive_client_id || '').trim(),
    clientSecret: (settings.gdrive_client_secret || '').trim(),
    refreshToken: (settings.gdrive_refresh_token || '').trim(),
    expectedAccountEmail: (settings.gdrive_account_email || '').trim().toLowerCase(),
    connectedAccountEmail: (settings.gdrive_connected_email || '').trim().toLowerCase(),
    folderId: (settings.gdrive_folder_id || '').trim(),
    lastBackupAt: settings.gdrive_last_backup_at || ''
  };
};

const requestGoogleAccessToken = async (db: Database) => {
  const cfg = getGoogleConfig(db);

  if (!cfg.clientId) {
    throw new Error('Google Drive client ID is required in Settings.');
  }
  if (!cfg.refreshToken) {
    throw new Error('Google Drive is not connected. Please connect first.');
  }

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    refresh_token: cfg.refreshToken,
    grant_type: 'refresh_token'
  });

  if (cfg.clientSecret) {
    body.set('client_secret', cfg.clientSecret);
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || !data.access_token) {
    const description = String(data.error_description || data.error || 'Failed to get Google access token.');
    throw new Error(description);
  }

  return String(data.access_token);
};

const getGoogleUserEmail = async (accessToken: string) => {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const description = String(data.error_description || data.error || 'Failed to read Google account profile.');
    throw new Error(description);
  }
  return String(data.email || '').trim().toLowerCase();
};

export const startGoogleDeviceAuth = async (db: Database) => {
  const cfg = getGoogleConfig(db);
  if (!cfg.clientId) {
    throw new Error('Please set Google Drive Client ID in Settings first.');
  }

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    scope: GOOGLE_SCOPE
  });

  const res = await fetch(GOOGLE_DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || !data.device_code) {
    const description = String(data.error_description || data.error || 'Failed to start Google device auth.');
    throw new Error(description);
  }

  return {
    deviceCode: String(data.device_code),
    userCode: String(data.user_code || ''),
    verificationUrl: String(data.verification_url || 'https://www.google.com/device'),
    expiresIn: Number(data.expires_in || 900),
    interval: Number(data.interval || 5)
  };
};

export const finishGoogleDeviceAuth = async (
  db: Database,
  payload: { deviceCode: string; interval?: number; timeoutSeconds?: number }
) => {
  const cfg = getGoogleConfig(db);
  if (!cfg.clientId) {
    throw new Error('Please set Google Drive Client ID in Settings first.');
  }
  if (!payload.deviceCode) {
    throw new Error('Missing Google device code. Start connection flow again.');
  }

  const pollingInterval = Math.max(3, Number(payload.interval || 5));
  const timeoutMs = Math.max(60, Number(payload.timeoutSeconds || 300)) * 1000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      device_code: payload.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    });

    if (cfg.clientSecret) {
      body.set('client_secret', cfg.clientSecret);
    }

    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });

    const data = (await res.json()) as Record<string, unknown>;

    if (res.ok && (data.refresh_token || data.access_token)) {
      const refreshToken = String(data.refresh_token || '').trim();
      const accessToken = String(data.access_token || '').trim();

      if (!refreshToken && !cfg.refreshToken) {
        throw new Error('Google did not return a refresh token. Disconnect Drive and reconnect with consent.');
      }
      if (!accessToken) {
        throw new Error('Google did not return an access token.');
      }

      const userEmail = await getGoogleUserEmail(accessToken);
      if (!userEmail) {
        throw new Error('Could not identify Google account email.');
      }

      if (cfg.expectedAccountEmail && userEmail !== cfg.expectedAccountEmail) {
        throw new Error(`Connected account mismatch. Expected ${cfg.expectedAccountEmail}, but got ${userEmail}.`);
      }

      if (refreshToken) {
        setSetting(db, 'gdrive_refresh_token', refreshToken);
      }
      setSetting(db, 'gdrive_connected_email', userEmail);
      return { connected: true, accountEmail: userEmail };
    }

    const code = String(data.error || '');
    if (code === 'authorization_pending') {
      await sleep(pollingInterval * 1000);
      continue;
    }

    if (code === 'slow_down') {
      await sleep((pollingInterval + 5) * 1000);
      continue;
    }

    if (code === 'access_denied') {
      throw new Error('Google authorization was denied.');
    }

    const description = String(data.error_description || data.error || 'Failed to complete Google auth.');
    throw new Error(description);
  }

  throw new Error('Google authorization timed out. Please retry.');
};

export const disconnectGoogleDrive = (db: Database) => {
  setSetting(db, 'gdrive_refresh_token', '');
  setSetting(db, 'gdrive_connected_email', '');
  return { disconnected: true };
};

/**
 * Debounced background auto-publish. Triggered by inventory write IPC routes
 * when the `gdrive_stocks_auto_publish` setting is enabled. Errors are logged
 * but never bubble up to the user — the inventory write itself succeeds first.
 */
let autoPublishTimer: NodeJS.Timeout | null = null;
const AUTO_PUBLISH_DEBOUNCE_MS = 8000;

export const triggerAutoPublishStocks = (db: Database) => {
  try {
    const settings = settingsService.getAll(db) as Record<string, string>;
    if ((settings.gdrive_stocks_auto_publish || '0') !== '1') return;
    if (!(settings.gdrive_refresh_token || '').trim()) return;

    if (autoPublishTimer) clearTimeout(autoPublishTimer);
    autoPublishTimer = setTimeout(() => {
      autoPublishTimer = null;
      publishStocksToWebDrive(db).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[stocks auto-publish failed]', (err as Error).message);
      });
    }, AUTO_PUBLISH_DEBOUNCE_MS);
  } catch {
    // never let auto-publish break the inventory write
  }
};

/**
 * Build a public-safe JSON snapshot of the current stocks for the GitHub Pages viewer.
 * Strips private fields (cost price, profit margin, supplier, internal notes).
 */
const buildStocksSnapshot = (db: Database) => {
  const items = inventoryService.list(db) as any[];

  const publicItems = items.map((item) => ({
    id: item.id,
    name: String(item.name || ''),
    brand: String(item.brand || ''),
    category: String(item.category || ''),
    sku: String(item.sku || ''),
    quantityInStock: Number(item.quantityInStock || 0),
    reorderLevel: Number(item.reorderLevel || 0),
    sellingPrice: Number(item.effectiveSellingPrice || item.sellingPrice || 0),
    isLowStock: Number(item.quantityInStock || 0) <= Number(item.reorderLevel || 0),
    inStock: Number(item.quantityInStock || 0) > 0,
    updatedAt: item.updatedAt
  }));

  const settings = settingsService.getAll(db) as Record<string, string>;

  return {
    version: 1,
    publishedAt: new Date().toISOString(),
    business: {
      name: settings.business_name || '',
      currency: settings.default_currency || 'LKR'
    },
    stats: {
      totalItems: publicItems.length,
      lowStockCount: publicItems.filter((p) => p.isLowStock).length,
      outOfStockCount: publicItems.filter((p) => !p.inStock).length
    },
    items: publicItems
  };
};

const driveCreatePublicJsonFile = async (
  accessToken: string,
  bodyJson: string,
  parentFolderId: string | null
) => {
  const metadata: Record<string, unknown> = {
    name: STOCKS_FILE_NAME,
    mimeType: 'application/json'
  };
  if (parentFolderId) {
    metadata.parents = [parentFolderId];
  }

  const boundary = `boundary_${Date.now()}`;
  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
      metadata
    )}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
    'utf8'
  );
  const content = Buffer.from(bodyJson, 'utf8');
  const end = Buffer.from(`\r\n--${boundary}--`, 'utf8');
  const body = Buffer.concat([preamble, content, end]);

  const res = await fetch(`${GOOGLE_DRIVE_UPLOAD_BASE}?uploadType=multipart&fields=id,name`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length)
    },
    body
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || !data.id) {
    const message = String((data.error as any)?.message || 'Failed to create stocks file in Drive.');
    throw new Error(message);
  }

  // Make the file readable by anyone with the link.
  const permRes = await fetch(`${GOOGLE_DRIVE_FILES_URL}/${data.id}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ role: 'reader', type: 'anyone' })
  });

  if (!permRes.ok) {
    const errData = (await permRes.json().catch(() => ({}))) as Record<string, unknown>;
    const message = String((errData.error as any)?.message || 'Failed to make stocks file public.');
    throw new Error(message);
  }

  return String(data.id);
};

const driveUpdateFileContent = async (accessToken: string, fileId: string, bodyJson: string) => {
  const res = await fetch(`${GOOGLE_DRIVE_UPLOAD_BASE}/${fileId}?uploadType=media&fields=id,name`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: bodyJson
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || !data.id) {
    const message = String((data.error as any)?.message || 'Failed to update stocks file in Drive.');
    // 404 → file was deleted/unshared. Caller will recreate.
    if (res.status === 404) {
      throw new Error('STOCKS_FILE_MISSING');
    }
    throw new Error(message);
  }
  return String(data.id);
};

const driveCheckFileExists = async (accessToken: string, fileId: string) => {
  const res = await fetch(`${GOOGLE_DRIVE_FILES_URL}/${fileId}?fields=id`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return res.ok;
};

/**
 * Publish (or refresh) the public stocks JSON to Drive. The file is shared as
 * "anyone with link can view" so the GitHub Pages viewer can fetch it via the
 * Drive API + a public read-only API key.
 *
 * Returns the file ID, public viewer URL, and timestamp.
 */
export const publishStocksToWebDrive = async (db: Database) => {
  const cfg = getGoogleConfig(db);

  if (!cfg.refreshToken) {
    throw new Error('Google Drive is not connected. Please connect Drive first in Settings.');
  }

  const accessToken = await requestGoogleAccessToken(db);
  const userEmail = await getGoogleUserEmail(accessToken);

  if (cfg.expectedAccountEmail && userEmail !== cfg.expectedAccountEmail) {
    throw new Error(`Connected Google account is ${userEmail}. Please use ${cfg.expectedAccountEmail}.`);
  }

  const snapshot = buildStocksSnapshot(db);
  const json = JSON.stringify(snapshot);

  const settings = settingsService.getAll(db) as Record<string, string>;
  let fileId = (settings.gdrive_stocks_file_id || '').trim();

  if (fileId) {
    const exists = await driveCheckFileExists(accessToken, fileId);
    if (!exists) fileId = '';
  }

  if (fileId) {
    try {
      await driveUpdateFileContent(accessToken, fileId, json);
    } catch (err) {
      if ((err as Error).message === 'STOCKS_FILE_MISSING') {
        fileId = '';
      } else {
        throw err;
      }
    }
  }

  if (!fileId) {
    fileId = await driveCreatePublicJsonFile(
      accessToken,
      json,
      cfg.folderId || null
    );
    setSetting(db, 'gdrive_stocks_file_id', fileId);
  }

  const publishedAt = snapshot.publishedAt;
  setSetting(db, 'gdrive_stocks_published_at', publishedAt);

  return {
    fileId,
    publishedAt,
    itemCount: snapshot.items.length,
    lowStockCount: snapshot.stats.lowStockCount,
    outOfStockCount: snapshot.stats.outOfStockCount,
    // The Drive API URL the viewer will fetch (requires a public API key).
    driveApiUrl: `${GOOGLE_DRIVE_FILES_URL}/${fileId}?alt=media`
  };
};

/**
 * Unpublish: revoke the "anyone" permission so the file is no longer publicly readable.
 * The file ID is forgotten locally; the file itself remains in the user's Drive.
 */
export const unpublishStocksFromWebDrive = async (db: Database) => {
  const cfg = getGoogleConfig(db);
  const settings = settingsService.getAll(db) as Record<string, string>;
  const fileId = (settings.gdrive_stocks_file_id || '').trim();

  if (!cfg.refreshToken) {
    throw new Error('Google Drive is not connected.');
  }
  if (!fileId) {
    setSetting(db, 'gdrive_stocks_published_at', '');
    return { unpublished: true };
  }

  const accessToken = await requestGoogleAccessToken(db);

  const permsRes = await fetch(`${GOOGLE_DRIVE_FILES_URL}/${fileId}/permissions?fields=permissions(id,type)`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (permsRes.ok) {
    const data = (await permsRes.json()) as { permissions?: Array<{ id: string; type: string }> };
    const anyonePerm = (data.permissions || []).find((p) => p.type === 'anyone');
    if (anyonePerm) {
      await fetch(`${GOOGLE_DRIVE_FILES_URL}/${fileId}/permissions/${anyonePerm.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` }
      });
    }
  }

  setSetting(db, 'gdrive_stocks_file_id', '');
  setSetting(db, 'gdrive_stocks_published_at', '');
  return { unpublished: true };
};

export const uploadBackupToGoogleDrive = async (db: Database) => {
  const cfg = getGoogleConfig(db);
  const accessToken = await requestGoogleAccessToken(db);
  const userEmail = await getGoogleUserEmail(accessToken);

  if (!userEmail) {
    throw new Error('Could not identify connected Google account.');
  }
  if (cfg.expectedAccountEmail && userEmail !== cfg.expectedAccountEmail) {
    throw new Error(`Connected Google account is ${userEmail}. Please use ${cfg.expectedAccountEmail} for backups.`);
  }

  if (userEmail !== cfg.connectedAccountEmail) {
    setSetting(db, 'gdrive_connected_email', userEmail);
  }

  const sourceDb = getDatabasePath();
  if (!fs.existsSync(sourceDb)) {
    throw new Error('Local database file was not found.');
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `localbiz-backup-${timestamp}.sqlite`;
  const tempFile = path.join(os.tmpdir(), backupName);
  fs.copyFileSync(sourceDb, tempFile);

  try {
    const metadata: Record<string, unknown> = {
      name: backupName,
      mimeType: 'application/x-sqlite3'
    };

    if (cfg.folderId) {
      metadata.parents = [cfg.folderId];
    }

    const boundary = `boundary_${Date.now()}`;
    const preamble = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
        metadata
      )}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      'utf8'
    );
    const content = fs.readFileSync(tempFile);
    const end = Buffer.from(`\r\n--${boundary}--`, 'utf8');
    const body = Buffer.concat([preamble, content, end]);

    const res = await fetch(GOOGLE_DRIVE_UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length)
      },
      body
    });

    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const message = String((data.error as any)?.message || 'Failed to upload backup to Google Drive.');
      throw new Error(message);
    }

    const now = new Date().toISOString();
    setSetting(db, 'gdrive_last_backup_at', now);

    return {
      uploaded: true,
      fileId: String(data.id || ''),
      fileName: String(data.name || backupName),
      backedUpAt: now,
      accountEmail: userEmail,
      driveFolderId: cfg.folderId || null
    };
  } finally {
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch {
      // no-op
    }
  }
};
