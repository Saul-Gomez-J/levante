import { useMemo, useState } from 'react';
import { ExternalLink, FileArchive, FileText, Download } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useSidePanelStore } from '@/stores/sidePanelStore';
import { useSkillsStore } from '@/stores/skillsStore';
import { useProjectStore } from '@/stores/projectStore';
import { SkillInstallScopeModal } from '@/components/skills/SkillInstallScopeModal';
import type { InstallSkillOptions } from '../../../types/skills';

interface PresentedFile {
  path: string;
  name: string;
  description?: string;
  size: number;
  extension: string;
  isSkillPackage: boolean;
  exists: boolean;
  error?: string;
}

interface PresentedFilesCardProps {
  files: PresentedFile[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function PresentedFilesCard({ files }: PresentedFilesCardProps) {
  const { t } = useTranslation('chat');
  const { installFromZip } = useSkillsStore();
  const { openFileTab } = useSidePanelStore();
  const { projects } = useProjectStore();

  const [selectedInstallFile, setSelectedInstallFile] = useState<PresentedFile | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);

  const projectsWithCwd = useMemo(
    () => projects.filter((p) => p.cwd && p.cwd.trim() !== ''),
    [projects]
  );

  const doInstall = async (file: PresentedFile, options: InstallSkillOptions) => {
    setIsInstalling(true);
    try {
      const installed = await installFromZip(file.path, options);
      toast.success(t('tools_menu.skills.custom_import.success', { name: installed.name }));
    } catch (error) {
      toast.error(
        t('tools_menu.skills.custom_import.error', {
          message: error instanceof Error ? error.message : String(error),
        })
      );
    } finally {
      setIsInstalling(false);
      setSelectedInstallFile(null);
    }
  };

  const handleInstallClick = (file: PresentedFile) => {
    if (projectsWithCwd.length > 0) {
      setSelectedInstallFile(file);
      return;
    }
    void doInstall(file, { scope: 'global' });
  };

  return (
    <>
      <div className="mt-2 flex flex-col gap-2">
        {files.map((file) => (
          <div key={file.path} className="flex items-center gap-3 rounded-lg border bg-card p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
              {file.isSkillPackage ? (
                <FileArchive className="h-5 w-5 text-muted-foreground" />
              ) : (
                <FileText className="h-5 w-5 text-muted-foreground" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{file.name}</div>
              <div className="text-xs text-muted-foreground">
                {file.exists
                  ? file.description || formatSize(file.size)
                  : file.error || t('present_files.missing')}
              </div>
            </div>

            {file.exists && !file.isSkillPackage && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => void openFileTab(file.path)}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t('present_files.open')}
              </Button>
            )}

            {file.isSkillPackage && (
              <Button
                size="sm"
                variant="default"
                className="gap-1.5"
                disabled={!file.exists || isInstalling}
                onClick={() => handleInstallClick(file)}
              >
                <Download className="h-3.5 w-3.5" />
                {t('present_files.install_skill')}
              </Button>
            )}
          </div>
        ))}
      </div>

      {selectedInstallFile && (
        <SkillInstallScopeModal
          open={!!selectedInstallFile}
          skillName={selectedInstallFile.name}
          projects={projects}
          onConfirm={(options) => void doInstall(selectedInstallFile, options)}
          onCancel={() => setSelectedInstallFile(null)}
        />
      )}
    </>
  );
}
