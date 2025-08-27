import React, { useState, Fragment, useEffect, useRef } from 'react';
import { Dialog, Combobox, Transition } from '@headlessui/react';
import { DocumentSearchFilters, DocumentType } from './types';
import { IconSearch } from './Icons';

interface Command {
  id: string;
  name: string;
  action: () => void;
  category: string;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  applyFilters: (newFilters: Partial<DocumentSearchFilters>) => void;
}

const DOCUMENT_TYPES: DocumentType[] = ['GRN', 'Sales', 'Invoice', 'PurchaseOrders'];

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, applyFilters }) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      // focus the input when the palette opens
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  const commands: Command[] = [
    ...DOCUMENT_TYPES.map(type => ({
      id: `filter-type-${type}`,
      name: `Filter by Type: ${type}`,
      action: () => applyFilters({ type }),
      category: 'Filters',
    })),
    { id: 'filter-type-all', name: 'Filter by Type: All', action: () => applyFilters({ type: 'All' }), category: 'Filters' },
    { id: 'sort-date', name: 'Sort by: Date', action: () => applyFilters({ sortBy: 'date' }), category: 'Sorting' },
    { id: 'sort-ref', name: 'Sort by: Reference', action: () => applyFilters({ sortBy: 'referenceId' }), category: 'Sorting' },
    { id: 'dir-desc', name: 'Direction: Descending', action: () => applyFilters({ sortDir: 'desc' }), category: 'Sorting' },
    { id: 'dir-asc', name: 'Direction: Ascending', action: () => applyFilters({ sortDir: 'asc' }), category: 'Sorting' },
  ];

  const filteredCommands = query === ''
    ? commands
    : commands.filter(command => command.name.toLowerCase().includes(query.toLowerCase()));

  const handleSelect = (command: Command) => {
    command.action();
    onClose();
  };

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-50">
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-200" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/30" />
        </Transition.Child>

        <div className="fixed inset-0 p-4 flex items-start justify-center pt-[10vh]">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
            leave="ease-in duration-200" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
          >
            <Dialog.Panel className="w-full max-w-xl bg-white rounded-lg shadow-2xl">
              <Combobox onChange={handleSelect}>
                <div className="relative">
                  <IconSearch className="pointer-events-none absolute top-3.5 left-4 h-5 w-5 text-gray-400" />
                  <Combobox.Input
                    ref={inputRef}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
                    className="h-12 w-full border-0 bg-transparent pl-11 pr-4 text-gray-900 placeholder:text-gray-400 focus:ring-0 sm:text-sm"
                    placeholder="Type a command or search..."
                  />
                </div>
                <Combobox.Options static className="max-h-80 overflow-y-auto border-t">
                  {filteredCommands.map(command => (
                    <Combobox.Option
                      key={command.id}
                      value={command}
                      className={({ active }) => `p-3 text-sm cursor-pointer ${active ? 'bg-blue-600 text-white' : 'bg-white text-gray-800'}`}
                    >
                      {command.name}
                    </Combobox.Option>
                  ))}
                  {query && filteredCommands.length === 0 && <p className="p-4 text-sm text-gray-500">No results found.</p>}
                </Combobox.Options>
              </Combobox>
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition.Root>
  );
};

export default CommandPalette;
