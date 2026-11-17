import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CookieNotice } from './CookieNotice';

describe('cookie notice', () => {
  it('explains local sign-in storage and stays dismissed', async () => {
    localStorage.removeItem('floor.cookieNotice');
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CookieNotice />
      </MemoryRouter>,
    );
    expect(screen.getByRole('dialog', { name: 'Storage notice' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cookie policy' })).toHaveAttribute('href', '/cookies');
    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('dialog', { name: 'Storage notice' })).not.toBeInTheDocument();
    expect(localStorage.getItem('floor.cookieNotice')).toBe('1');
  });
});
