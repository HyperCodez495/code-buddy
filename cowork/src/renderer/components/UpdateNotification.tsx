/**
 * UpdateNotification — Toast/banner for available app updates
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Download, X, RefreshCw } from 'lucide-react';
import type { UpdateInfo } from '../types';

interface UpdateNotificationProps {
  updateInfo: UpdateInfo;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss: () => void;
}

export const UpdateNotification: React.FC<UpdateNotificationProps> = ({
  updateInfo,
  onDownload,
  onInstall,
  onDismiss,
}) => {
  const { t } = useTranslation();
  if (!updateInfo.available) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-blue-500/10 border-b border-blue-500/20">
      <Download size={14} className="text-blue-400 flex-shrink-0" />

      <div className="flex-1 min-w-0">
        {updateInfo.downloaded ? (
          <span className="text-xs text-blue-300">
            {t('updateNotification.downloaded', {
              version: updateInfo.version,
              defaultValue: 'Update {{version}} downloaded. Restart to apply.',
            })}
          </span>
        ) : updateInfo.downloadProgress !== undefined ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-blue-300">
              {t('updateNotification.downloading', 'Downloading update…')}
            </span>
            <div className="flex-1 h-1 bg-surface rounded-full overflow-hidden max-w-32">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${updateInfo.downloadProgress}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">{Math.round(updateInfo.downloadProgress)}%</span>
          </div>
        ) : (
          <span className="text-xs text-blue-300">
            {t('updateNotification.available', {
              version: updateInfo.version,
              defaultValue: 'Update {{version}} available',
            })}
          </span>
        )}
      </div>

      {updateInfo.downloaded ? (
        <button
          onClick={onInstall}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
        >
          <RefreshCw size={12} />
          {t('updateNotification.restart', 'Restart')}
        </button>
      ) : !updateInfo.downloadProgress ? (
        <button
          onClick={onDownload}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
        >
          <Download size={12} />
          {t('updateNotification.download', 'Download')}
        </button>
      ) : null}

      <button
        onClick={onDismiss}
        className="text-muted-foreground hover:text-secondary transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
};
