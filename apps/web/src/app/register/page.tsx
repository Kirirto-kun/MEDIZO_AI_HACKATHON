'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { DocJobLogo } from '@/components/icons';
import { LanguageSwitcher } from '@/components/language-switcher';
import { trpc } from '@/lib/trpc/react';
import { SUBGROUPS } from '@/lib/case-taxonomy';

const REGION_KEYS = [
  'astana',
  'almaty',
  'shymkent',
  'karaganda',
  'aktobe',
  'taraz',
  'pavlodar',
  'ustKamenogorsk',
  'semey',
  'atyrau',
  'kostanay',
  'kyzylorda',
  'uralsk',
  'petropavlovsk',
  'aktau',
  'turkistan',
  'taldykorgan',
  'temirtau',
  'kokshetau',
  'other',
] as const;

type AccountKind = 'user' | 'reviewer';

export default function RegisterPage() {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations('auth.register');
  const [isLoading, setIsLoading] = useState(false);
  const [accountKind, setAccountKind] = useState<AccountKind>('user');

  const SPECIALTIES = useMemo(() => {
    const clinicalSpecialties = SUBGROUPS.find((s) => s.slug === 'clinical')?.specialties ?? [];
    return Array.from(new Set([...clinicalSpecialties, t('specialtyOther')]));
  }, [t]);

  const REGIONS = useMemo(
    () => REGION_KEYS.map((k) => ({ key: k, label: t(`regions.${k}`) })),
    [t],
  );

  const registerSchema = useMemo(
    () =>
      z
        .object({
          accountKind: z.enum(['user', 'reviewer']),
          fullName: z.string().min(2, t('errors.fullNameMin')),
          region: z.string().min(1, t('errors.regionRequired')),
          age: z.coerce
            .number({ invalid_type_error: t('errors.ageNumber') })
            .int(t('errors.ageInt'))
            .min(16, t('errors.ageMin'))
            .max(100, t('errors.ageMax')),
          specialty: z.string().min(1, t('errors.specialtyRequired')),
          workplace: z.string().optional(),
          academicDegree: z.string().optional(),
          email: z.string().email(t('errors.emailInvalid')),
          phoneNumber: z
            .string()
            .min(7, t('errors.phoneMin'))
            .regex(/^[\d +\-()]+$/, t('errors.phoneFormat')),
          password: z.string().min(6, t('errors.passwordMin')),
          consentAccepted: z.literal(true, {
            errorMap: () => ({ message: t('errors.consentRequired') }),
          }),
        })
        .superRefine((data, ctx) => {
          if (data.accountKind === 'reviewer') {
            if (!data.workplace || data.workplace.trim().length < 2) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['workplace'],
                message: t('errors.workplaceRequired'),
              });
            }
            if (!data.academicDegree || data.academicDegree.trim().length < 2) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['academicDegree'],
                message: t('errors.academicDegreeRequired'),
              });
            }
          }
        }),
    [t],
  );
  type RegisterFormValues = z.infer<typeof registerSchema>;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isValid },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    mode: 'onChange',
    defaultValues: {
      accountKind: 'user',
      fullName: '',
      region: '',
      specialty: '',
      workplace: '',
      academicDegree: '',
      email: '',
      phoneNumber: '',
      password: '',
      consentAccepted: undefined,
    },
  });

  const regionValue = watch('region');
  const specialtyValue = watch('specialty');
  const consentValue = watch('consentAccepted');

  const registerMutation = trpc.users.register.useMutation();

  const onTabChange = (value: string) => {
    const next = value === 'reviewer' ? 'reviewer' : 'user';
    setAccountKind(next);
    setValue('accountKind', next, { shouldValidate: true });
  };

  const onSubmit: SubmitHandler<RegisterFormValues> = async (data) => {
    setIsLoading(true);
    try {
      await registerMutation.mutateAsync({
        email: data.email,
        password: data.password,
        name: data.fullName,
        fullName: data.fullName,
        region: data.region,
        age: data.age,
        specialty: data.specialty,
        phoneNumber: data.phoneNumber,
        workplace: data.accountKind === 'reviewer' ? data.workplace : undefined,
        academicDegree: data.accountKind === 'reviewer' ? data.academicDegree : undefined,
        consentAccepted: data.consentAccepted,
        role: data.accountKind === 'reviewer' ? 'REVIEWER' : 'DOCTOR',
      });
    } catch (e) {
      toast({
        variant: 'destructive',
        title: t('toast.errorTitle'),
        description: e instanceof Error ? e.message : t('toast.errorTitle'),
      });
      return;
    } finally {
      setIsLoading(false);
    }

    toast({
      title: t('toast.pendingTitle'),
      description: t('toast.pendingDescription'),
    });
    router.push('/login?pending=1');
    router.refresh();
  };

  return (
    <div className="relative flex min-h-screen min-h-svh w-full min-w-0 max-w-full items-start justify-center overflow-x-clip bg-background p-4 pt-16 sm:items-center sm:pt-4">
      <div className="absolute right-4 top-4 z-10">
        <LanguageSwitcher variant="outline" />
      </div>
      <Card className="my-auto w-full min-w-0 max-w-lg">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <DocJobLogo className="h-16 w-16" />
          </div>
          <CardTitle className="text-2xl font-headline">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={accountKind} onValueChange={onTabChange} className="mb-6">
            <TabsList className="grid w-full min-w-0 grid-cols-2">
              <TabsTrigger value="user" className="min-w-0 px-1.5 text-xs min-[380px]:px-3 min-[380px]:text-sm">
                {t('accountKind.user')}
              </TabsTrigger>
              <TabsTrigger value="reviewer" className="min-w-0 px-1.5 text-xs min-[380px]:px-3 min-[380px]:text-sm">
                {t('accountKind.reviewer')}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">{t('fullNameLabel')}</Label>
              <Input id="fullName" {...register('fullName')} />
              {errors.fullName && (
                <p className="text-sm text-destructive">{errors.fullName.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="region">{t('regionLabel')}</Label>
              <Select
                value={regionValue || undefined}
                onValueChange={(value) => setValue('region', value, { shouldValidate: true })}
              >
                <SelectTrigger id="region">
                  <SelectValue placeholder={t('regionPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {REGIONS.map((r) => (
                    <SelectItem key={r.key} value={r.label}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.region && (
                <p className="text-sm text-destructive">{errors.region.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="age">{t('ageLabel')}</Label>
              <Input id="age" type="number" inputMode="numeric" {...register('age')} />
              {errors.age && <p className="text-sm text-destructive">{errors.age.message}</p>}
            </div>

            {accountKind === 'reviewer' ? (
              <div className="space-y-2">
                <Label htmlFor="workplace">{t('workplaceLabel')}</Label>
                <Input id="workplace" {...register('workplace')} />
                {errors.workplace && (
                  <p className="text-sm text-destructive">{errors.workplace.message}</p>
                )}
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="specialty">{t('specialtyLabel')}</Label>
              <Select
                value={specialtyValue || undefined}
                onValueChange={(value) => setValue('specialty', value, { shouldValidate: true })}
              >
                <SelectTrigger id="specialty">
                  <SelectValue placeholder={t('specialtyPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {SPECIALTIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.specialty && (
                <p className="text-sm text-destructive">{errors.specialty.message}</p>
              )}
            </div>

            {accountKind === 'reviewer' ? (
              <div className="space-y-2">
                <Label htmlFor="academicDegree">{t('academicDegreeLabel')}</Label>
                <Input
                  id="academicDegree"
                  placeholder={t('academicDegreePlaceholder')}
                  {...register('academicDegree')}
                />
                {errors.academicDegree && (
                  <p className="text-sm text-destructive">{errors.academicDegree.message}</p>
                )}
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="email">{t('emailLabel')}</Label>
              <Input id="email" type="email" {...register('email')} />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="phoneNumber">{t('phoneLabel')}</Label>
              <Input id="phoneNumber" type="tel" {...register('phoneNumber')} />
              {errors.phoneNumber && (
                <p className="text-sm text-destructive">{errors.phoneNumber.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t('passwordLabel')}</Label>
              <PasswordInput id="password" {...register('password')} />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>

            <div className="flex items-start gap-2 pt-2">
              <Checkbox
                id="consentAccepted"
                checked={consentValue === true}
                onCheckedChange={(checked) => {
                  const next = checked === true;
                  setValue('consentAccepted', next as true, { shouldValidate: true });
                }}
              />
              <Label
                htmlFor="consentAccepted"
                className="text-sm font-normal leading-snug text-muted-foreground"
              >
                {t.rich('consentLabel', {
                  terms: (chunks) => (
                    <Link
                      href="/legal/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {chunks}
                    </Link>
                  ),
                  privacy: (chunks) => (
                    <Link
                      href="/legal/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </Label>
            </div>
            {errors.consentAccepted && (
              <p className="text-sm text-destructive">
                {errors.consentAccepted.message ?? t('errors.consentRequired')}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={!isValid || isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('submit')}
            </Button>
          </form>

          <div className="mt-4 text-center text-sm">
            <span className="text-muted-foreground">{t('haveAccount')} </span>
            <Link href="/login" className="text-primary hover:underline">
              {t('loginCta')}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
