import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';

export default function MobileCounter({ initialQuantity = 0, onSubmit }) {
  const { width } = useWindowDimensions();
  const BUTTON_SIZE = Math.min((width * 0.6 - 40) / 3, 80);
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
      // Prevent negative numbers if needed, but here we just prevent less than 0
      return Math.max(0, next).toString();
    });
  };

  const handleSubmit = () => {
    if (onSubmit) {
      onSubmit(parseInt(inputQuantity || '0', 10));
    }
  };

  const renderButton = (label, onPress, isSecondary = false, isAction = false) => (
    <TouchableOpacity
      style={[
        styles.button,
        isSecondary && styles.secondaryButton,
        isAction && styles.actionButton,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text
        style={[
          styles.buttonText,
          isSecondary && styles.secondaryButtonText,
          isAction && styles.actionButtonText,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.leftColumn}>
        <View style={styles.row}>
          {renderButton('1', () => handleNumberPress(1), false, false, BUTTON_SIZE)}
          {renderButton('2', () => handleNumberPress(2), false, false, BUTTON_SIZE)}
          {renderButton('3', () => handleNumberPress(3), false, false, BUTTON_SIZE)}
        </View>
        <View style={styles.row}>
          {renderButton('4', () => handleNumberPress(4), false, false, BUTTON_SIZE)}
          {renderButton('5', () => handleNumberPress(5), false, false, BUTTON_SIZE)}
          {renderButton('6', () => handleNumberPress(6), false, false, BUTTON_SIZE)}
        </View>
        <View style={styles.row}>
          {renderButton('7', () => handleNumberPress(7), false, false, BUTTON_SIZE)}
          {renderButton('8', () => handleNumberPress(8), false, false, BUTTON_SIZE)}
          {renderButton('9', () => handleNumberPress(9), false, false, BUTTON_SIZE)}
        </View>
        <View style={styles.row}>
          {renderButton('C', handleClear, true, false, BUTTON_SIZE)}
          {renderButton('0', () => handleNumberPress(0), false, false, BUTTON_SIZE)}
          {renderButton('⌫', handleBackspace, true, false, BUTTON_SIZE)}
        </View>
      </View>

      <View style={styles.rightColumn}>
        <View style={styles.displayContainer}>
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

        <View style={styles.quickActionsContainer}>
          <TouchableOpacity style={styles.quickButton} onPress={() => handleIncrement(-1)}>
            <Text style={styles.quickButtonText}>−1</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.quickButton, { marginLeft: 4 }]} onPress={() => handleIncrement(1)}>
            <Text style={styles.quickButtonText}>+1</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.submitButton}
          onPress={handleSubmit}
          activeOpacity={0.7}
        >
          <Text style={styles.submitButtonText}>Submit</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  leftColumn: {
    flex: 0.6,
    justifyContent: 'center',
    paddingRight: 6,
  },
  rightColumn: {
    flex: 0.4,
    flexDirection: 'column',
    paddingLeft: 6,
    borderLeftWidth: 1,
    borderLeftColor: '#e5e7eb',
  },
  displayContainer: {
    flex: 0.28,
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingVertical: 6,
  },
  displayLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 2,
  },
  displayText: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
  },
  quickActionsContainer: {
    flex: 0.14,
    flexDirection: 'row',
    marginBottom: 8,
  },
  quickButton: {
    flex: 1,
    backgroundColor: '#e5e7eb',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#374151',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    width: '100%',
    marginBottom: 8,
  },
  button: {
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  buttonText: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  secondaryButton: {
    backgroundColor: '#fee2e2',
    borderColor: '#fca5a5',
  },
  secondaryButtonText: {
    color: '#ef4444',
  },
  actionButton: {
    backgroundColor: '#3b82f6',
    borderColor: '#2563eb',
  },
  actionButtonText: {
    color: '#ffffff',
  },
  submitButton: {
    flex: 1,
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
  },
});
