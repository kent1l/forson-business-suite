import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';

export default function MobileCounter({ initialQuantity = 0, onSubmit }) {
  const { width, height } = useWindowDimensions();
  const maxContainerWidth = Math.min(width, 500); // Cap width for tablet scaling
  const leftColWidth = maxContainerWidth * 0.4;
  const rightColWidth = maxContainerWidth * 0.6;
  const BUTTON_GAP = 8;
  // Calculate button size based on rightColWidth (60% of container width)
  const BUTTON_SIZE = Math.floor((rightColWidth - 16 - (2 * BUTTON_GAP)) / 3);
  const ROW_HEIGHT = BUTTON_SIZE; // Lock aspect ratio to 1:1

  const [inputQuantity, setInputQuantity] = useState(initialQuantity.toString());

  const handleNumberPress = (num) => {
    setInputQuantity((prev) => {
      // Don't allow multiple leading zeros
      if (prev === '0') return num.toString();
      return prev + num.toString();
    });
  };

  const handleClear = () => {
    setInputQuantity('0');
  };

  const handleBackspace = () => {
    setInputQuantity((prev) => {
      if (prev.length <= 1) return '0';
      return prev.slice(0, -1);
    });
  };

  const handleIncrement = (amount) => {
    setInputQuantity((prev) => {
      const current = parseInt(prev || '0', 10);
      const next = current + amount;
      return Math.max(0, next).toString();
    });
  };

  const handleSubmit = () => {
    if (onSubmit) {
      onSubmit(parseInt(inputQuantity || '0', 10));
    }
  };

  const buttonStyle = {
    width: BUTTON_SIZE,
    height: ROW_HEIGHT,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  };

  const renderButton = (label, onPress, isSecondary = false) => (
    <TouchableOpacity
      style={[
        buttonStyle,
        isSecondary && styles.secondaryButton,
      ]}
      onPress={onPress}
      activeOpacity={0.65}
    >
      <Text
        style={[
          styles.buttonText,
          isSecondary && styles.secondaryButtonText,
        ]}
        adjustsFontSizeToFit
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  const containerStyle = {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    paddingHorizontal: 8,
    paddingVertical: 8,
    width: maxContainerWidth,
    height: 4 * ROW_HEIGHT + 3 * BUTTON_GAP + 16,
    alignSelf: 'center',
    marginTop: 'auto',
  };

  return (
    <View style={containerStyle}>
      {/* Left Column - Display & Actions (40% width) */}
      <View style={[styles.leftColumn, { width: leftColWidth }]}>
        {/* Row 1: Qty Display */}
        <View style={[styles.displayContainer, { height: ROW_HEIGHT }]}>
          <Text style={styles.displayLabel}>Qty</Text>
          <Text
            style={styles.displayText}
            adjustsFontSizeToFit
            numberOfLines={1}
            minimumFontScale={0.4}
          >
            {inputQuantity}
          </Text>
        </View>

        {/* Row 2: Quick Actions */}
        <View style={[styles.quickActionsContainer, { height: ROW_HEIGHT }]}>
          <TouchableOpacity style={styles.quickButton} onPress={() => handleIncrement(-1)} activeOpacity={0.65}>
            <Text style={styles.quickButtonText}>−1</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickButton} onPress={() => handleIncrement(1)} activeOpacity={0.65}>
            <Text style={styles.quickButtonText}>+1</Text>
          </TouchableOpacity>
        </View>

        {/* Rows 3 & 4: Submit Button */}
        <TouchableOpacity
          style={[styles.submitButton, { height: 2 * ROW_HEIGHT + BUTTON_GAP }]}
          onPress={handleSubmit}
          activeOpacity={0.7}
        >
          <Text style={styles.submitButtonText}>Submit</Text>
        </TouchableOpacity>
      </View>

      {/* Right Column - Numeric Keypad (60% width) */}
      <View style={[styles.rightColumn, { width: rightColWidth }]}>
        <View style={styles.row}>
          {renderButton('1', () => handleNumberPress(1))}
          {renderButton('2', () => handleNumberPress(2))}
          {renderButton('3', () => handleNumberPress(3))}
        </View>
        <View style={styles.row}>
          {renderButton('4', () => handleNumberPress(4))}
          {renderButton('5', () => handleNumberPress(5))}
          {renderButton('6', () => handleNumberPress(6))}
        </View>
        <View style={styles.row}>
          {renderButton('7', () => handleNumberPress(7))}
          {renderButton('8', () => handleNumberPress(8))}
          {renderButton('9', () => handleNumberPress(9))}
        </View>
        <View style={styles.row}>
          {renderButton('C', handleClear, true)}
          {renderButton('0', () => handleNumberPress(0))}
          {renderButton('⌫', handleBackspace, true)}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  leftColumn: {
    flexDirection: 'column',
    gap: 8,
    paddingRight: 6,
    alignSelf: 'stretch',
  },
  rightColumn: {
    flexDirection: 'column',
    gap: 8,
    paddingLeft: 8,
    borderLeftWidth: 1,
    borderLeftColor: '#e5e7eb',
    alignSelf: 'stretch',
  },
  displayContainer: {
    backgroundColor: '#f3f4f6',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  displayLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: '#6b7280',
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  displayText: {
    fontSize: 42,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
  },
  quickActionsContainer: {
    flexDirection: 'row',
    gap: 8,
    alignSelf: 'stretch',
  },
  quickButton: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#374151',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    alignSelf: 'stretch',
  },
  buttonText: {
    fontSize: 28,
    fontWeight: '600',
    color: '#1f2937',
    textAlign: 'center',
  },
  secondaryButton: {
    backgroundColor: '#fee2e2',
    borderColor: '#fca5a5',
  },
  secondaryButtonText: {
    color: '#ef4444',
  },
  submitButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
});
