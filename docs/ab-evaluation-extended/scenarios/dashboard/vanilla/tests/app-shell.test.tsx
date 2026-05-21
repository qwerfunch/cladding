import {render, screen} from '@testing-library/react';
import {test, expect} from 'vitest';
import {App} from '../src/App';

test('App renders the Analytics Dashboard header', () => {
  render(<App />);
  expect(screen.getByText(/analytics dashboard/i)).toBeInTheDocument();
});
