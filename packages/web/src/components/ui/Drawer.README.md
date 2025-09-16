# Drawer Component Refactoring

## Overview

The Drawer component has been completely refactored to be highly reusable and flexible, while maintaining backward compatibility with existing usage.

## Key Improvements

### 1. **Enhanced Configuration Options**
- **Positioning**: Support for all 4 directions (left, right, top, bottom)
- **Sizing**: Predefined sizes (sm, md, lg, xl, full) plus custom CSS classes
- **Styling**: Fully customizable backdrop, drawer, header, and content styles
- **Animation**: Configurable duration and easing

### 2. **Flexible Header System**
- **Optional Header**: Can be hidden completely
- **Custom Headers**: Render prop support for custom header components
- **Close Button**: Customizable close button with render prop
- **Header Styling**: Custom CSS classes for header

### 3. **Compound Component Pattern**
```jsx
<Drawer isOpen={isOpen} onClose={onClose} showHeader={false}>
  <Drawer.Header>Custom Header</Drawer.Header>
  <Drawer.Content>Main Content</Drawer.Content>
  <Drawer.Footer>Footer Actions</Drawer.Footer>
</Drawer>
```

### 4. **Advanced Behavior Controls**
- **Backdrop Interaction**: Configurable click-to-close behavior
- **Keyboard Support**: Optional Escape key handling
- **Scroll Management**: Optional body scroll locking
- **Event Callbacks**: onOpen and onCloseComplete callbacks

### 5. **Accessibility Improvements**
- Proper ARIA attributes
- Keyboard navigation support
- Focus management
- Screen reader compatibility

## Migration Guide

### Existing Usage (Still Works)
```jsx
<Drawer
  isOpen={isOpen}
  onClose={onClose}
  title="My Title"
  position="right"
  size="md"
>
  Content
</Drawer>
```

### New Advanced Usage
```jsx
<Drawer
  isOpen={isOpen}
  onClose={onClose}
  position="left"
  size="lg"
  backdropClassName="bg-blue-900/60"
  drawerClassName="border-l-4 border-blue-500"
  headerClassName="bg-blue-50"
  contentClassName="bg-gray-50"
  closeOnBackdropClick={true}
  closeOnEscape={true}
  lockBodyScroll={true}
  animationDuration={300}
  onOpen={() => console.log('Drawer opened')}
>
  <div className="p-6">
    <h3 className="text-xl font-bold">Advanced Drawer</h3>
    <p>With custom styling and behavior</p>
  </div>
</Drawer>
```

## API Reference

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isOpen` | boolean | - | Controls drawer visibility |
| `onClose` | function | - | Called when drawer should close |
| `children` | ReactNode | - | Drawer content |
| `position` | string | 'right' | Drawer position: 'left', 'right', 'top', 'bottom' |
| `size` | string | 'md' | Drawer size: 'sm', 'md', 'lg', 'xl', 'full' or custom class |
| `title` | string | - | Header title |
| `showHeader` | boolean | true | Show/hide header |
| `showCloseButton` | boolean | true | Show/hide close button |
| `headerClassName` | string | '' | Custom header CSS classes |
| `contentClassName` | string | '' | Custom content CSS classes |
| `backdropClassName` | string | 'bg-neutral-800/50' | Custom backdrop CSS classes |
| `drawerClassName` | string | '' | Custom drawer CSS classes |
| `backdropZIndex` | string | 'z-40' | Backdrop z-index |
| `drawerZIndex` | string | 'z-50' | Drawer z-index |
| `closeOnBackdropClick` | boolean | true | Close on backdrop click |
| `closeOnEscape` | boolean | true | Close on Escape key |
| `lockBodyScroll` | boolean | true | Lock body scroll when open |
| `animationDuration` | number | 300 | Animation duration in ms |
| `animationEasing` | string | 'ease-in-out' | Animation easing |
| `onOpen` | function | - | Called when drawer opens |
| `renderHeader` | function | - | Custom header render function |
| `renderCloseButton` | function | - | Custom close button render function |

### Compound Components

- `Drawer.Header`: Header section
- `Drawer.Content`: Main content area
- `Drawer.Footer`: Footer section

## Examples

See the comprehensive examples in the component documentation for various usage patterns including:
- Basic usage
- Custom styling
- Compound components
- Custom render functions
- Minimal drawers

## Backward Compatibility

The refactored component maintains 100% backward compatibility with existing usage. All existing Drawer implementations will continue to work without any changes.