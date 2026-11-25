import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-3 py-16">
      <h1 className="text-2xl font-bold">{t('notFound.title')}</h1>
      <p className="text-text-muted">{t('notFound.body')}</p>
      <Button asChild>
        <Link to="/">{t('notFound.back')}</Link>
      </Button>
    </div>
  );
}
