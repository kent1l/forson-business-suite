import React from 'react';
import { render } from '@testing-library/react';
import DocumentsPage from '../src/pages/DocumentsPage';

test('DocumentsPage renders without crashing', () => {
  const { getByText } = render(<DocumentsPage />);
  expect(getByText(/Documents/i)).toBeTruthy();
});
