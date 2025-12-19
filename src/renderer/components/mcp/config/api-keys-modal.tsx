import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Key } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MCPConfigField } from '@/types/mcp';

interface ApiKeysModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => void;
  serverName: string;
  fields: MCPConfigField[];
}

export function ApiKeysModal({ isOpen, onClose, onSubmit, serverName, fields }: ApiKeysModalProps) {
  const { t } = useTranslation('mcp');
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Initialize values with defaults when fields change
  useEffect(() => {
    const initialValues: Record<string, string> = {};
    fields.forEach(field => {
      if (field.defaultValue) {
        initialValues[field.key] = field.defaultValue;
      }
    });
    setValues(initialValues);
  }, [fields]);

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};

    // Prepare final values, including defaults for fields not filled
    const finalValues: Record<string, string> = {};
    fields.forEach(field => {
      const value = values[field.key];
      if (value !== undefined && value !== '') {
        // User provided a value
        finalValues[field.key] = value;
      } else if (field.defaultValue) {
        // Use default value if available
        finalValues[field.key] = field.defaultValue;
      } else if (field.required) {
        // Required field with no value and no default
        newErrors[field.key] = t('config.validation.field_required', { field: field.label });
      }
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Submit values
    onSubmit(finalValues);

    // Reset form
    setValues({});
    setErrors({});
  };

  const handleCancel = () => {
    setValues({});
    setErrors({});
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleCancel}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            <DialogTitle>{t('config.api_keys.title', { name: serverName })}</DialogTitle>
          </div>
          <DialogDescription>
            {t('config.api_keys.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Security Warning */}
          <Alert className="border-yellow-500/50 bg-yellow-100/60 dark:bg-yellow-900/30 dark:border-yellow-700/50">
            <AlertTriangle className="h-4 w-4 text-yellow-700 dark:text-yellow-400" />
            <AlertDescription className="text-yellow-900 dark:text-yellow-100 text-sm">
              {t('config.api_keys.security_warning')}
            </AlertDescription>
          </Alert>

          {/* Input fields */}
          {fields.map(field => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={field.key}>
                {field.label}
                {field.required && <span className="text-destructive ml-1">*</span>}
              </Label>
              <Input
                id={field.key}
                type={field.type === 'password' ? 'password' : 'text'}
                placeholder={field.placeholder}
                value={values[field.key] || ''}
                onChange={(e) => {
                  setValues(prev => ({ ...prev, [field.key]: e.target.value }));
                  if (errors[field.key]) {
                    setErrors(prev => {
                      const newErrors = { ...prev };
                      delete newErrors[field.key];
                      return newErrors;
                    });
                  }
                }}
                className={errors[field.key] ? 'border-destructive' : ''}
              />
              {field.description && (
                <p className="text-xs text-muted-foreground">{field.description}</p>
              )}
              {errors[field.key] && (
                <p className="text-xs text-destructive">{errors[field.key]}</p>
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {t('dialog.cancel')}
          </Button>
          <Button onClick={handleSubmit}>
            {t('config.api_keys.add_server')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
