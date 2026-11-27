import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/services/api';
import { Alert } from '@/components/ui/alert';
import { errorMessage } from '@/utils/errors';

/** Mutation with field errors (by last path segment), a general error and a success notice. */
export function useFormAction(fn, onDone) {
  const { t } = useTranslation();
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const m = useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      setErrors({});
      setError(null);
      setNotice(onDone?.(data) ?? null);
    },
    onError: (e) => {
      setNotice(null);
      if (e instanceof ApiError && e.errors.length) {
        setErrors(e.fieldErrors());
        setError(e.errors.map((x) => x.message).join(' '));
      } else setError(errorMessage(e, t));
    },
  });
  const run = (...args) => {
    setErrors({});
    setError(null);
    setNotice(null);
    m.mutate(...args);
  };
  return { run, pending: m.isPending, errors, error, notice };
}

export function FormMessages({ action }) {
  return (
    <>
      {action.notice && <Alert tone="success">{action.notice}</Alert>}
      {action.error && <Alert tone="error">{action.error}</Alert>}
    </>
  );
}
