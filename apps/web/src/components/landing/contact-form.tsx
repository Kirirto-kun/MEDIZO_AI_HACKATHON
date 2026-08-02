'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { sendContactMessage } from '@/app/actions';

const EarthCanvas = dynamic(() => import('./earth-canvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[300px] w-full items-center justify-center text-sm text-muted-foreground">
      …
    </div>
  ),
});

export function LandingContactForm() {
  const t = useTranslations('landing.contacts.form');
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const schema = z.object({
    name: z.string().min(1, t('errors.name')).max(100),
    email: z.string().email(t('errors.email')).max(200),
    message: z.string().min(1, t('errors.message')).max(2000),
    company: z.string().optional(),
  });
  type Values = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: Values) => {
    setIsLoading(true);
    const res = await sendContactMessage(data);
    setIsLoading(false);
    if (res.success) {
      toast({ title: t('successTitle'), description: t('successDescription') });
      reset();
    } else {
      toast({ variant: 'destructive', title: t('errorTitle'), description: res.error });
    }
  };

  return (
    <div className="flex min-w-0 flex-col-reverse gap-8 xl:flex-row">
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="min-w-0 w-full xl:flex-[0.75]"
      >
        <Card className="border-border/60 bg-card/60 p-6 md:p-8">
          <h3 className="font-headline text-xl font-semibold md:text-2xl">{t('heading')}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{t('subtitle')}</p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 flex flex-col gap-5">
            {/* honeypot: hidden from humans, off the tab order */}
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="hidden"
              {...register('company')}
            />

            <div className="space-y-2">
              <Label htmlFor="cf-name">{t('nameLabel')}</Label>
              <Input id="cf-name" placeholder={t('namePlaceholder')} {...register('name')} />
              {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="cf-email">{t('emailLabel')}</Label>
              <Input id="cf-email" type="email" placeholder={t('emailPlaceholder')} {...register('email')} />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="cf-message">{t('messageLabel')}</Label>
              <Textarea id="cf-message" rows={6} placeholder={t('messagePlaceholder')} {...register('message')} />
              {errors.message && <p className="text-sm text-destructive">{errors.message.message}</p>}
            </div>

            <Button type="submit" disabled={isLoading} className="w-fit">
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isLoading ? t('submitting') : t('submit')}
            </Button>
          </form>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="flex min-w-0 w-full flex-col xl:flex-1"
      >
        <div className="h-[320px] md:h-[460px] xl:h-full xl:min-h-[460px]">
          <EarthCanvas />
        </div>
        <p className="mt-2 text-center text-[11px] text-muted-foreground/70">{t('modelCredit')}</p>
      </motion.div>
    </div>
  );
}
