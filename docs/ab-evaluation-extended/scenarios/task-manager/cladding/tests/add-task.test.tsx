import {render, screen, fireEvent} from '@testing-library/react';
import {test, expect} from 'vitest';
import {App} from '../src/App';

test('adding a task makes it visible in the list', () => {
  render(<App />);
  const input = screen.getByPlaceholderText(/what needs doing/i);
  fireEvent.change(input, {target: {value: 'Buy milk'}});
  fireEvent.submit(input.closest('form')!);
  expect(screen.getByText('Buy milk')).toBeInTheDocument();
});
