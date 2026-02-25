import { useState } from 'react';
import { StoreLayout } from '@/components/mcp/store-page/store-layout';
import SkillsPage from '@/pages/SkillsPage';
import { Toaster } from 'sonner';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Store } from 'lucide-react';
import { cn } from '@/lib/utils';

type StoreSection = 'mcps' | 'skills';

const SECTIONS: { id: StoreSection; label: string }[] = [
  { id: 'mcps', label: 'MCPs' },
  { id: 'skills', label: 'Skills' },
];

const StorePage = () => {
  const [activeSection, setActiveSection] = useState<StoreSection>('mcps');
  const [installed, setInstalled] = useState(true);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Section tabs — always visible */}
      <div className="px-6 pt-4 pb-3 shrink-0">
        {/* Tabs — centered */}
        <div className="flex justify-center">
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

        {/* See store / Back — centered below tabs */}
        <div className="flex justify-center mt-3">
          {installed ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setInstalled(false)}
              className="gap-2"
            >
              <Store className="w-4 h-4" />
              See store
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setInstalled(true)}
              className="gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      {activeSection === 'mcps' && (
        <div className="flex-1 overflow-y-auto">
          <StoreLayout installed={installed} />
        </div>
      )}

      {activeSection === 'skills' && (
        <div className="flex-1 overflow-y-auto">
          <SkillsPage installed={installed} />
        </div>
      )}

      <Toaster position="top-right" />
    </div>
  );
};

export default StorePage;
