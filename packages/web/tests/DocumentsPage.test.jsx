import React from 'react';
import { render } from '@testing-library/react';
import DocumentsPage from '../src/pages/DocumentsPage';

test('DocumentsPage renders without crashing', () => {
  const { getAllByText } = render(<DocumentsPage />);
  expect(getAllByText(/Documents/i).length).toBeGreaterThan(0);
});
