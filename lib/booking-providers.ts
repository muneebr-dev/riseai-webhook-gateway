import { BookingProvider } from './types';

const BOOKING_PROVIDER_ALIASES: Record<string, BookingProvider> = {
  google_calendar: 'google_calendar',
  'google-calendar': 'google_calendar',
  outlook_calendar: 'outlook_calendar',
  'outlook-calendar': 'outlook_calendar',
  calendly: 'calendly',
  square_appointments: 'square_appointments',
  'square-appointments': 'square_appointments',
  square: 'square_appointments',
};

export function normalizeBookingProvider(
  provider: string,
): BookingProvider | null {
  return BOOKING_PROVIDER_ALIASES[provider] ?? null;
}
