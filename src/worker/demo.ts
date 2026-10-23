import type { AgendaFeed } from '../shared/types';

// Sample agenda for AGENDA_FEED_URL=demo, dated relative to today so it always looks current.
export function demoFeed(): AgendaFeed {
  const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const at = (offset: number, hhmm: string) => `${day(offset)}T${hhmm}:00Z`;
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    sources: [
      { id: 'family', name: 'Family', color: '#94A3B8' },
      { id: 'alex', name: 'Alex', color: '#2563FF' },
      { id: 'jordan', name: 'Jordan', color: '#7C3AED' },
    ],
    events: [
      { id: 'e1', source: 'family', title: 'Bin day: recycling', start: day(0), end: day(1), allDay: true },
      { id: 'e2', source: 'alex', title: 'Dentist', start: at(0, '09:30'), allDay: false, location: 'High Street' },
      { id: 'e3', source: 'jordan', title: 'Team offsite', start: at(0, '13:00'), allDay: false },
      { id: 'e4', source: 'family', title: 'Swimming lessons', start: at(1, '16:30'), allDay: false },
      { id: 'e5', source: 'jordan', title: 'Book club', start: at(1, '19:30'), allDay: false },
      { id: 'e6', source: 'alex', title: 'Car service', start: at(2, '08:00'), allDay: false },
      { id: 'e7', source: 'family', title: 'Half term', start: day(3), end: day(8), allDay: true },
      { id: 'e8', source: 'family', title: 'Dinner with friends', start: at(3, '18:30'), allDay: false },
    ],
    tasks: [
      { id: 't1', source: 'alex', title: 'Renew car insurance', due: day(-2) },
      { id: 't2', source: 'jordan', title: 'Order birthday present', due: day(0) },
      { id: 't3', source: 'family', title: 'Fix garden gate' },
    ],
  };
}
