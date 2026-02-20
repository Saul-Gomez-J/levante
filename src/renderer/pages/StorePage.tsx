import { useState } from 'react';
import { StoreLayout } from '@/components/mcp/store-page/store-layout';
import SkillsPage from '@/pages/SkillsPage';
import { Toaster } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

type StoreSection = 'mcps' | 'skills';
type ViewMode = 'active' | 'store';

const SECTIONS: { id: StoreSection; label: string }[] = [
  { id: 'mcps', label: 'MCPs' },
  { id: 'skills', label: 'Skills' },
];

const StorePage = () => {
  const [activeSection, setActiveSection] = useState<StoreSection>('mcps');
  const [viewMode, setViewMode] = useState<ViewMode>('active');

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Store mode header: Back button + section tabs */}
      {viewMode === 'store' && (
        <div className="px-6 pt-4 pb-2 shrink-0 relative flex items-center justify-center">
          <div className="absolute left-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setViewMode('active')}
              className="gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
          </div>
          <div className="inline-flex items-center rounded-lg bg-muted p-1 gap-1">
            {SECTIONS.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  'px-4 py-1.5 rounded-md text-sm font-medium transition-all',
                  activeSection === section.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {section.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      {viewMode === 'active' && (
        <div className="flex-1 overflow-y-auto">
          <StoreLayout mode="active" onModeChange={setViewMode} />
        </div>
      )}

      {viewMode === 'store' && activeSection === 'mcps' && (
        <div className="flex-1 overflow-y-auto">
          <StoreLayout mode="store" onModeChange={setViewMode} />
        </div>
      )}

      {viewMode === 'store' && activeSection === 'skills' && (
        <div className="flex-1 overflow-hidden">
          <SkillsPage />
        </div>
      )}

      <Toaster position="top-right" />
    </div>
  );
};

export default StorePage;
