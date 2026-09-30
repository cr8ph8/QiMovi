import { fireEvent, screen, within } from '@testing-library/react';
import { expect } from 'vitest';

/** Reach any production phase through the same visible Find tool control. */
export function openStudioTool(name: string) {
  // Old journey names still follow the renamed visible export tool.
  const label = name === 'Bundle' ? 'Export saved writing' : ['Nodes', 'Storyboard flow'].includes(name) ? 'Movie workspace' : name;
  const candidates = screen.getAllByLabelText('CanIScreenwrite workspace modes').filter(element => !element.closest('[hidden]'));
  expect(candidates).toHaveLength(1);
  const navigation = candidates[0];
  fireEvent.change(within(navigation).getByRole('textbox', { name: 'Find a studio tool' }), { target: { value: label } });
  const menu = within(navigation).getByRole('tabpanel');
  const button = within(menu).getByText(label, { exact: true, selector: 'button span' }).closest('button');
  expect(button).toBeVisible();
  expect(button).toBeEnabled();
  fireEvent.click(button!);
  const clear = screen.queryByLabelText('Clear tool search', { selector: 'button' });
  if (clear) fireEvent.click(clear);
}

export function openFilmWorkspace(studio: HTMLElement) {
  const navigation = within(studio).getByLabelText('CanIScreenwrite workspace modes');
  fireEvent.change(within(navigation).getByRole('textbox', { name: 'Find a studio tool' }), { target: { value: 'Full movie storyboard' } });
  const button = within(within(navigation).getByRole('tabpanel')).getByText('Full movie storyboard', { exact: true, selector: 'button span' }).closest('button');
  expect(button).toBeVisible();
  expect(button).toBeEnabled();
  fireEvent.click(button!);
}
