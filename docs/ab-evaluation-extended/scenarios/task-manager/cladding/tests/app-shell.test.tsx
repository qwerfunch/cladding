import {render, screen} from '@testing-library/react';
import {test, expect} from 'vitest';
import {App} from '../src/App';

test('App renders the Task Manager header', () => {
  render(<App />);
  expect(screen.getByText(/task manager/i)).toBeInTheDocument();
});
