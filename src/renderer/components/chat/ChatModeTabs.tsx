import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from 'react-i18next';

interface ChatModeTabsProps {
  coworkMode: boolean;
  onCoworkModeChange: (enabled: boolean) => void;
}

export function ChatModeTabs({ coworkMode, onCoworkModeChange }: ChatModeTabsProps) {
  const { t } = useTranslation('chat');

  return (
    <div className="flex justify-center py-2">
      <Tabs
        value={coworkMode ? 'cowork' : 'chat'}
        onValueChange={(value) => onCoworkModeChange(value === 'cowork')}
      >
        <TabsList>
          <TabsTrigger value="chat">
            {t('mode_tabs.chat', 'Chat')}
          </TabsTrigger>
          <TabsTrigger value="cowork">
            {t('mode_tabs.cowork', 'Cowork')}
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
